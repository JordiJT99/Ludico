import type { GeneratedContentCandidate, ContentFinding } from "@ludico/domain";
import { validateGeneratedContent } from "@ludico/domain";
import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { SqlClient, TransactionClient } from "./sql-client.js";

export interface ContentJob {
  readonly id: string;
  readonly contentType: "crossword" | "quiz";
  readonly targetDate: string;
  readonly provider: string;
  readonly promptVersion: string;
  readonly budgetMicros: number;
}

export interface GeneratedContentRecord {
  readonly id: string;
  readonly contentType: "crossword" | "quiz";
  readonly targetDate: string;
  readonly status: "approved" | "pending_review" | "rejected" | "selected";
  readonly publicPayload: unknown;
  readonly privatePayload: unknown;
  readonly sources: unknown;
  readonly findings: readonly ContentFinding[];
}

export interface AdminContentCalendar {
  readonly editions: readonly {
    readonly gameCount: number;
    readonly id: string;
    readonly localDate: string;
    readonly status: string;
  }[];
  readonly reserve: { readonly crossword: number; readonly quiz: number };
}

export interface BlockedTermRecord {
  readonly active: boolean;
  readonly id: string;
  readonly normalizedTerm: string;
  readonly reason: string;
}

export class ContentPipelineError extends Error {
  constructor(
    readonly code:
      | "BUDGET_EXCEEDED"
      | "BLOCKED_TERM_NOT_FOUND"
      | "CONTENT_NOT_FOUND"
      | "CONTENT_NOT_REVIEWABLE"
      | "EDITION_ALREADY_EXISTS"
      | "INSUFFICIENT_APPROVED_CONTENT"
      | "JOB_NOT_RUNNING"
      | "INVALID_BLOCKED_TERM"
      | "INVALID_REASON"
      | "VALIDATION_FAILED",
  ) {
    super(code);
  }
}

export async function planContentGenerationJobs(
  client: SqlClient,
  startDate: string,
  days: number,
  provider: string,
  budgetMicros: number,
): Promise<readonly ContentJob[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || days < 1 || days > 21 || budgetMicros < 0) {
    throw new RangeError("Plan de contenido inválido");
  }
  return client.transaction(async (transaction) => {
    const jobs: ContentJob[] = [];
    for (let offset = 0; offset < days; offset += 1) {
      const targetDate = addDays(startDate, offset);
      for (const contentType of ["quiz", "crossword"] as const) {
        const result = await transaction.query<ContentJob & QueryResultRow>(
          `insert into content_generation_jobs
             (content_type, target_date, provider, budget_micros)
           values ($1, $2::date, $3, $4)
           on conflict (content_type, target_date) do update
             set provider = content_generation_jobs.provider
           returning id, content_type as "contentType", target_date::text as "targetDate",
                     provider, prompt_version as "promptVersion", budget_micros as "budgetMicros"`,
          [contentType, targetDate, provider, budgetMicros],
        );
        jobs.push(result.rows[0]!);
      }
    }
    return jobs;
  });
}

export async function claimContentGenerationJob(
  client: SqlClient,
  jobId: string,
  now: Date,
): Promise<ContentJob | null> {
  const result = await client.query<ContentJob & QueryResultRow>(
    `update content_generation_jobs
     set status = 'running', started_at = $2, error_code = null,
         updated_at = $2, version = version + 1
     where id = $1 and status = 'queued'
     returning id, content_type as "contentType", target_date::text as "targetDate",
               provider, prompt_version as "promptVersion", budget_micros as "budgetMicros"`,
    [jobId, now],
  );
  return result.rows[0] ?? null;
}

export async function recordGeneratedContent(
  client: SqlClient,
  jobId: string,
  candidate: GeneratedContentCandidate,
  assurance: Readonly<{ evaluatorPassed: boolean; sourcesVerified: boolean }>,
  costMicros: number,
  now: Date,
): Promise<GeneratedContentRecord> {
  return client.transaction(async (transaction) => {
    const job = await transaction.query<
      {
        budgetMicros: number;
        contentType: string;
        provider: string;
        targetDate: string;
      } & QueryResultRow
    >(
      `select budget_micros as "budgetMicros", content_type as "contentType", provider,
              target_date::text as "targetDate"
       from content_generation_jobs where id = $1 and status = 'running' for update`,
      [jobId],
    );
    const current = job.rows[0];
    if (!current || current.contentType !== candidate.type) {
      throw new ContentPipelineError("JOB_NOT_RUNNING");
    }
    if (costMicros < 0 || costMicros > current.budgetMicros) {
      throw new ContentPipelineError("BUDGET_EXCEEDED");
    }

    const blocked = await transaction.query<{ normalizedTerm: string } & QueryResultRow>(
      `select normalized_term as "normalizedTerm" from blocked_terms where active = true`,
    );
    const validation = validateGeneratedContent(candidate, {
      blockedTerms: blocked.rows.map(({ normalizedTerm }) => normalizedTerm),
      ...(current.provider === "fake" || current.provider === "deterministic"
        ? {}
        : { knownSemanticCandidates: await listSemanticCandidates(transaction, candidate.type) }),
    });
    const contentHash = createHash("sha256").update(validation.canonicalContent).digest("hex");
    const duplicate = await transaction.query(
      `select 1 from generated_contents where content_hash = $1 and status <> 'rejected' limit 1`,
      [contentHash],
    );
    const findings: ContentFinding[] = [
      ...validation.findings,
      ...(!assurance.sourcesVerified ? ([{ code: "SOURCE_UNVERIFIED" }] as const) : []),
      ...(!assurance.evaluatorPassed ? ([{ code: "EVALUATOR_REVIEW" }] as const) : []),
      ...(duplicate.rows[0] ? ([{ code: "DUPLICATE_CONTENT" }] as const) : []),
    ];
    const outcome = duplicate.rows[0]
      ? "failed"
      : validation.status === "rejected"
        ? "failed"
        : validation.status === "review" || !assurance.sourcesVerified || !assurance.evaluatorPassed
          ? "review"
          : "passed";
    const status =
      outcome === "passed" ? "approved" : outcome === "review" ? "pending_review" : "rejected";
    const created = await transaction.query<GeneratedContentRecord & QueryResultRow>(
      `insert into generated_contents
         (generation_job_id, content_type, target_date, status, public_payload,
          private_payload, sources, content_hash, findings, created_at, updated_at)
       values ($1, $2, $3::date, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $10)
       returning id, content_type as "contentType", target_date::text as "targetDate", status,
                 public_payload as "publicPayload", private_payload as "privatePayload",
                 sources, findings`,
      [
        jobId,
        candidate.type,
        current.targetDate,
        status,
        JSON.stringify(candidate.publicPayload),
        JSON.stringify(candidate.privatePayload),
        JSON.stringify(candidate.sources),
        contentHash,
        JSON.stringify(findings),
        now,
      ],
    );
    const content = created.rows[0]!;
    await transaction.query(
      `insert into validation_results
         (generated_content_id, validator, validator_version, outcome, details, created_at)
       values ($1, 'deterministic', 'v1', $2, $3::jsonb, $4)`,
      [content.id, outcome, JSON.stringify(findings), now],
    );
    await transaction.query(
      `update content_generation_jobs
       set status = 'succeeded', cost_micros = $2, finished_at = $3,
           updated_at = $3, version = version + 1 where id = $1`,
      [jobId, costMicros, now],
    );
    await recordContentChange(transaction, {
      action: "generate",
      actorId: "worker",
      correlationId: jobId,
      eventType: "GeneratedContentValidated",
      reason: outcome,
      targetId: content.id,
    });
    return content;
  });
}

export async function failContentGenerationJob(
  client: SqlClient,
  jobId: string,
  errorCode: string,
  now: Date,
): Promise<boolean> {
  const result = await client.query(
    `update content_generation_jobs
     set status = 'failed', error_code = $2, finished_at = $3,
         updated_at = $3, version = version + 1
     where id = $1 and status = 'running'`,
    [jobId, errorCode.slice(0, 80), now],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listGeneratedContent(
  client: SqlClient,
  status?: GeneratedContentRecord["status"],
): Promise<readonly GeneratedContentRecord[]> {
  const result = await client.query<GeneratedContentRecord & QueryResultRow>(
    `select id, content_type as "contentType", target_date::text as "targetDate", status,
            public_payload as "publicPayload", private_payload as "privatePayload", sources, findings
     from generated_contents
     where ($1::text is null or status = $1)
     order by target_date, content_type, created_at`,
    [status ?? null],
  );
  return result.rows;
}

export async function getGeneratedContent(
  client: SqlClient,
  contentId: string,
): Promise<GeneratedContentRecord | null> {
  const result = await client.query<GeneratedContentRecord & QueryResultRow>(
    `select id, content_type as "contentType", target_date::text as "targetDate", status,
            public_payload as "publicPayload", private_payload as "privatePayload", sources,
            findings
     from generated_contents where id = $1`,
    [contentId],
  );
  return result.rows[0] ?? null;
}

export async function listBlockedTerms(
  client: TransactionClient,
): Promise<readonly BlockedTermRecord[]> {
  const result = await client.query<BlockedTermRecord & QueryResultRow>(
    `select id, normalized_term as "normalizedTerm", reason, active
     from blocked_terms order by active desc, normalized_term`,
  );
  return result.rows;
}

export async function upsertBlockedTerm(
  client: SqlClient,
  term: string,
  reason: string,
  actorId: string,
  correlationId: string,
  now: Date,
): Promise<BlockedTermRecord> {
  const normalizedTerm = normalizeBlockedTerm(term);
  const cleanReason = reason.trim();
  if (normalizedTerm.length < 2 || normalizedTerm.length > 80 || cleanReason.length < 10) {
    throw new ContentPipelineError("INVALID_BLOCKED_TERM");
  }
  return client.transaction(async (transaction) => {
    const result = await transaction.query<BlockedTermRecord & QueryResultRow>(
      `insert into blocked_terms (normalized_term, reason, active, created_at, updated_at)
       values ($1, $2, true, $3, $3)
       on conflict (normalized_term) do update
         set reason = excluded.reason, active = true, updated_at = excluded.updated_at,
             version = blocked_terms.version + 1
       returning id, normalized_term as "normalizedTerm", reason, active`,
      [normalizedTerm, cleanReason, now],
    );
    const record = result.rows[0]!;
    await recordBlockedTermChange(
      transaction,
      record.id,
      actorId,
      "block_term",
      cleanReason,
      correlationId,
    );
    return record;
  });
}

export async function deactivateBlockedTerm(
  client: SqlClient,
  id: string,
  reason: string,
  actorId: string,
  correlationId: string,
  now: Date,
): Promise<{ active: false; changed: boolean; id: string }> {
  if (reason.trim().length < 10) throw new ContentPipelineError("INVALID_BLOCKED_TERM");
  return client.transaction(async (transaction) => {
    const result = await transaction.query<{ id: string } & QueryResultRow>(
      `update blocked_terms
       set active = false, updated_at = $2, version = version + 1
       where id = $1 and active = true returning id`,
      [id, now],
    );
    if (!result.rowCount) {
      const existing = await transaction.query<{ active: boolean } & QueryResultRow>(
        "select active from blocked_terms where id = $1",
        [id],
      );
      if (!existing.rows[0]) throw new ContentPipelineError("BLOCKED_TERM_NOT_FOUND");
      return { active: false, changed: false, id };
    }
    await recordBlockedTermChange(
      transaction,
      id,
      actorId,
      "unblock_term",
      reason.trim(),
      correlationId,
    );
    return { active: false, changed: true, id };
  });
}

export async function getAdminContentCalendar(
  client: SqlClient,
  now = new Date(),
): Promise<AdminContentCalendar> {
  const [editions, reserve] = await Promise.all([
    client.query<
      { gameCount: number; id: string; localDate: string; status: string } & QueryResultRow
    >(
      `select edition.id, edition.local_date::text as "localDate", edition.status,
              count(game.id)::int as "gameCount"
       from daily_editions edition left join games game on game.edition_id = edition.id
       where edition.local_date >= (($1::timestamptz at time zone 'Europe/Madrid')::date - 7)
       group by edition.id order by edition.local_date limit 60`,
      [now],
    ),
    client.query<{ contentType: "crossword" | "quiz"; count: number } & QueryResultRow>(
      `select content_type as "contentType", count(*)::int as count
       from generated_contents
       where status = 'approved' and selected_edition_id is null
         and target_date >= (($1::timestamptz at time zone 'Europe/Madrid')::date)
       group by content_type`,
      [now],
    ),
  ]);
  const counts = new Map(reserve.rows.map((row) => [row.contentType, row.count]));
  return {
    editions: editions.rows,
    reserve: { crossword: counts.get("crossword") ?? 0, quiz: counts.get("quiz") ?? 0 },
  };
}

export async function reviewGeneratedContent(
  client: SqlClient,
  contentId: string,
  decision: "approved" | "rejected",
  actorId: string,
  reason: string,
  correlationId: string,
  now: Date,
): Promise<{ changed: boolean; status: "approved" | "rejected" }> {
  return client.transaction(async (transaction) => {
    const current = await transaction.query<
      { findings: ContentFinding[]; status: GeneratedContentRecord["status"] } & QueryResultRow
    >(`select status, findings from generated_contents where id = $1 for update`, [contentId]);
    const row = current.rows[0];
    if (!row) throw new ContentPipelineError("CONTENT_NOT_FOUND");
    if (row.status === decision) return { changed: false, status: decision };
    if (row.status === "selected") throw new ContentPipelineError("CONTENT_NOT_REVIEWABLE");
    if (
      decision === "approved" &&
      row.findings.some(
        (finding) =>
          !["EVALUATOR_REVIEW", "HIGH_RISK_REVIEW", "SOURCE_UNVERIFIED"].includes(finding.code),
      )
    ) {
      throw new ContentPipelineError("VALIDATION_FAILED");
    }
    await transaction.query(
      `update generated_contents
       set status = $2, updated_at = $3, version = version + 1 where id = $1`,
      [contentId, decision, now],
    );
    await recordContentChange(transaction, {
      action: decision === "approved" ? "approve" : "reject",
      actorId,
      correlationId,
      eventType: decision === "approved" ? "GeneratedContentApproved" : "GeneratedContentRejected",
      reason,
      targetId: contentId,
    });
    return { changed: true, status: decision };
  });
}

export async function regenerateGeneratedContent(
  client: SqlClient,
  contentId: string,
  actorId: string,
  reason: string,
  correlationId: string,
  now: Date,
): Promise<{ changed: boolean; jobId: string; status: "queued" }> {
  if (reason.trim().length < 10) throw new ContentPipelineError("INVALID_REASON");
  return client.transaction(async (transaction) => {
    const current = await transaction.query<
      {
        jobId: string;
        jobStatus: string;
        status: GeneratedContentRecord["status"];
      } & QueryResultRow
    >(
      `select content.status, content.generation_job_id as "jobId", job.status as "jobStatus"
       from generated_contents content
       join content_generation_jobs job on job.id = content.generation_job_id
       where content.id = $1 for update of content, job`,
      [contentId],
    );
    const row = current.rows[0];
    if (!row) throw new ContentPipelineError("CONTENT_NOT_FOUND");
    if (row.status === "selected") throw new ContentPipelineError("CONTENT_NOT_REVIEWABLE");
    if (row.status === "rejected" && row.jobStatus === "queued") {
      return { changed: false, jobId: row.jobId, status: "queued" };
    }
    await transaction.query(
      `update generated_contents
       set status = 'rejected', updated_at = $2, version = version + 1 where id = $1`,
      [contentId, now],
    );
    await transaction.query(
      `update content_generation_jobs
       set status = 'queued', cost_micros = 0, error_code = null, started_at = null,
           finished_at = null, updated_at = $2, version = version + 1 where id = $1`,
      [row.jobId, now],
    );
    await recordContentChange(transaction, {
      action: "regenerate",
      actorId,
      correlationId,
      eventType: "ContentRegenerationQueued",
      reason: reason.trim(),
      targetId: contentId,
    });
    return { changed: true, jobId: row.jobId, status: "queued" };
  });
}

export async function reviseGeneratedContent(
  client: SqlClient,
  contentId: string,
  revision: Readonly<{ privatePayload: unknown; publicPayload: unknown; sources: unknown }>,
  actorId: string,
  reason: string,
  correlationId: string,
  now: Date,
): Promise<GeneratedContentRecord> {
  if (reason.trim().length < 10) throw new ContentPipelineError("INVALID_REASON");
  return client.transaction(async (transaction) => {
    const current = await transaction.query<
      {
        contentType: "crossword" | "quiz";
        generationJobId: string;
        provider: string;
        status: GeneratedContentRecord["status"];
        targetDate: string;
      } & QueryResultRow
    >(
      `select generated_contents.generation_job_id as "generationJobId",
              generated_contents.content_type as "contentType",
              generated_contents.target_date::text as "targetDate",
              generated_contents.status, content_generation_jobs.provider
       from generated_contents
       join content_generation_jobs on content_generation_jobs.id = generated_contents.generation_job_id
       where generated_contents.id = $1 for update of generated_contents`,
      [contentId],
    );
    const row = current.rows[0];
    if (!row) throw new ContentPipelineError("CONTENT_NOT_FOUND");
    if (row.status === "selected") throw new ContentPipelineError("CONTENT_NOT_REVIEWABLE");
    if (!Array.isArray(revision.sources)) throw new ContentPipelineError("VALIDATION_FAILED");

    const candidate = {
      privatePayload: revision.privatePayload,
      publicPayload: revision.publicPayload,
      sources: revision.sources,
      type: row.contentType,
    } as GeneratedContentCandidate;
    const blocked = await transaction.query<{ normalizedTerm: string } & QueryResultRow>(
      `select normalized_term as "normalizedTerm" from blocked_terms where active = true`,
    );
    let validation;
    try {
      validation = validateGeneratedContent(candidate, {
        blockedTerms: blocked.rows.map(({ normalizedTerm }) => normalizedTerm),
        ...(row.provider === "fake"
          ? {}
          : {
              knownSemanticCandidates: await listSemanticCandidates(
                transaction,
                row.contentType,
                contentId,
              ),
            }),
      });
    } catch {
      throw new ContentPipelineError("VALIDATION_FAILED");
    }
    if (validation.status === "rejected") {
      throw new ContentPipelineError("VALIDATION_FAILED");
    }
    const contentHash = createHash("sha256").update(validation.canonicalContent).digest("hex");
    const duplicate = await transaction.query(
      `select 1 from generated_contents
       where content_hash = $1 and id <> $2 and status <> 'rejected' limit 1`,
      [contentHash, contentId],
    );
    if (duplicate.rows[0]) throw new ContentPipelineError("VALIDATION_FAILED");

    await transaction.query(
      `update generated_contents
       set status = 'rejected', updated_at = $2, version = version + 1 where id = $1`,
      [contentId, now],
    );
    const created = await transaction.query<GeneratedContentRecord & QueryResultRow>(
      `insert into generated_contents
         (generation_job_id, content_type, target_date, status, public_payload, private_payload,
          sources, content_hash, findings, created_at, updated_at)
       values ($1, $2, $3::date, 'pending_review', $4::jsonb, $5::jsonb, $6::jsonb, $7,
               $8::jsonb, $9, $9)
       returning id, content_type as "contentType", target_date::text as "targetDate", status,
                 public_payload as "publicPayload", private_payload as "privatePayload", sources,
                 findings`,
      [
        row.generationJobId,
        row.contentType,
        row.targetDate,
        JSON.stringify(candidate.publicPayload),
        JSON.stringify(candidate.privatePayload),
        JSON.stringify(candidate.sources),
        contentHash,
        JSON.stringify(validation.findings),
        now,
      ],
    );
    const content = created.rows[0]!;
    await transaction.query(
      `insert into validation_results
         (generated_content_id, validator, validator_version, outcome, details, created_at)
       values ($1, 'deterministic', 'manual-v1', 'review', $2::jsonb, $3)`,
      [content.id, JSON.stringify(validation.findings), now],
    );
    await recordContentChange(transaction, {
      action: "revise",
      actorId,
      correlationId,
      eventType: "GeneratedContentRevised",
      metadata: { previousContentId: contentId },
      reason: reason.trim(),
      targetId: content.id,
    });
    return content;
  });
}

export async function assembleApprovedEdition(
  client: SqlClient,
  localDate: string,
  opensAt: Date,
  closesAt: Date,
  now: Date,
): Promise<{ changed: boolean; editionId: string; status: "approved" }> {
  return client.transaction(async (transaction) => {
    const existing = await transaction.query<
      { editionId: string; gameCount: number; status: string } & QueryResultRow
    >(
      `select edition.id as "editionId", edition.status, count(game.id)::int as "gameCount"
       from daily_editions edition left join games game on game.edition_id = edition.id
       where edition.market = 'ES' and edition.local_date = $1::date and edition.status <> 'cancelled'
       group by edition.id`,
      [localDate],
    );
    const present = existing.rows[0];
    if (present && present.gameCount > 0) {
      if (present.status === "approved" && present.gameCount === 2) {
        return { changed: false, editionId: present.editionId, status: "approved" };
      }
      throw new ContentPipelineError("EDITION_ALREADY_EXISTS");
    }

    const selected: GeneratedContentRecord[] = [];
    for (const type of ["quiz", "crossword"] as const) {
      const result = await transaction.query<GeneratedContentRecord & QueryResultRow>(
        `select id, content_type as "contentType", target_date::text as "targetDate", status,
                public_payload as "publicPayload", private_payload as "privatePayload",
                sources, findings
         from generated_contents
         where status = 'approved' and selected_edition_id is null and content_type = $1
         order by (target_date = $2::date) desc, abs(target_date - $2::date), created_at
         limit 1 for update`,
        [type, localDate],
      );
      if (!result.rows[0]) throw new ContentPipelineError("INSUFFICIENT_APPROVED_CONTENT");
      selected.push(result.rows[0]);
    }

    const edition = present
      ? { id: present.editionId }
      : (
          await transaction.query<{ id: string } & QueryResultRow>(
            `insert into daily_editions
               (market, local_date, status, opens_at, closes_at, created_at, updated_at)
             values ('ES', $1::date, 'draft', $2, $3, $4, $4) returning id`,
            [localDate, opensAt, closesAt, now],
          )
        ).rows[0]!;
    for (const content of selected) {
      const game = await transaction.query<{ id: string } & QueryResultRow>(
        `insert into games
           (edition_id, type, status, public_payload, created_at, updated_at)
         values ($1, $2, 'active', $3::jsonb, $4, $4) returning id`,
        [edition.id, content.contentType, JSON.stringify(content.publicPayload), now],
      );
      await transaction.query(
        `insert into game_solutions (game_id, private_payload, created_at, updated_at)
         values ($1, $2::jsonb, $3, $3)`,
        [game.rows[0]!.id, JSON.stringify(content.privatePayload), now],
      );
      await transaction.query(
        `update generated_contents
         set status = 'selected', selected_edition_id = $2, updated_at = $3, version = version + 1
         where id = $1`,
        [content.id, edition.id, now],
      );
    }
    await transaction.query(
      `update daily_editions
       set status = 'approved', updated_at = $2, version = version + 1 where id = $1`,
      [edition.id, now],
    );
    await recordContentChange(transaction, {
      action: "assemble",
      actorId: "worker",
      correlationId: edition.id,
      eventType: "DailyEditionAssembled",
      reason: "approved content",
      targetId: edition.id,
    });
    return { changed: true, editionId: edition.id, status: "approved" };
  });
}

async function listSemanticCandidates(
  transaction: TransactionClient,
  contentType: "crossword" | "quiz",
  excludeId?: string,
): Promise<GeneratedContentCandidate[]> {
  const result = await transaction.query<
    {
      privatePayload: unknown;
      publicPayload: unknown;
      sources: unknown;
    } & QueryResultRow
  >(
    `select private_payload as "privatePayload", public_payload as "publicPayload", sources
     from generated_contents
     where content_type = $1 and status <> 'rejected' and ($2::uuid is null or id <> $2::uuid)
     order by created_at desc limit 200`,
    [contentType, excludeId ?? null],
  );
  return result.rows.map(
    (row) =>
      ({
        privatePayload: row.privatePayload,
        publicPayload: row.publicPayload,
        sources: row.sources,
        type: contentType,
      }) as GeneratedContentCandidate,
  );
}

async function recordContentChange(
  transaction: TransactionClient,
  change: {
    action: string;
    actorId: string;
    correlationId: string;
    eventType: string;
    metadata?: Record<string, unknown>;
    reason: string;
    targetId: string;
  },
) {
  const metadata = { reason: change.reason, ...change.metadata };
  await transaction.query(
    `insert into outbox_events (aggregate_type, aggregate_id, event_type, payload)
     values ('GeneratedContent', $1, $2, $3::jsonb)`,
    [change.targetId, change.eventType, JSON.stringify(metadata)],
  );
  await transaction.query(
    `insert into audit_logs
       (actor_type, actor_id, action, target_type, target_id, reason, correlation_id, metadata)
     values ($1, $2, $3, 'GeneratedContent', $4, $5, $6, $7::jsonb)`,
    [
      change.actorId === "worker" ? "worker" : "admin",
      change.actorId,
      change.action,
      change.targetId,
      change.reason,
      change.correlationId,
      JSON.stringify(change.metadata ?? {}),
    ],
  );
}

async function recordBlockedTermChange(
  transaction: TransactionClient,
  id: string,
  actorId: string,
  action: "block_term" | "unblock_term",
  reason: string,
  correlationId: string,
) {
  await transaction.query(
    `insert into outbox_events (aggregate_type, aggregate_id, event_type, payload)
     values ('BlockedTerm', $1, $2, $3::jsonb)`,
    [
      id,
      action === "block_term" ? "BlockedTermActivated" : "BlockedTermDeactivated",
      JSON.stringify({ reason }),
    ],
  );
  await transaction.query(
    `insert into audit_logs
       (actor_type, actor_id, action, target_type, target_id, reason, correlation_id, metadata)
     values ('admin', $1, $2, 'BlockedTerm', $3, $4, $5, '{}'::jsonb)`,
    [actorId, action, id, reason, correlationId],
  );
}

function normalizeBlockedTerm(value: string): string {
  return value.trim().normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-ES");
}

function addDays(localDate: string, offset: number): string {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  const value = new Date(Date.UTC(year, month - 1, day + offset));
  return value.toISOString().slice(0, 10);
}
