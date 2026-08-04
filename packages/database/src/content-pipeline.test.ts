import { PGlite } from "@electric-sql/pglite";
import type { CrosswordPublicPayload, QuizPublicPayload } from "@ludico/contracts";
import type { GeneratedContentCandidate } from "@ludico/domain";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  assembleApprovedEdition,
  claimContentGenerationJob,
  ContentPipelineError,
  deactivateBlockedTerm,
  getAdminContentCalendar,
  listBlockedTerms,
  planContentGenerationJobs,
  recordGeneratedContent,
  regenerateGeneratedContent,
  reviseGeneratedContent,
  reviewGeneratedContent,
  upsertBlockedTerm,
} from "./content-pipeline.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];
const now = new Date("2026-08-01T10:00:00Z");

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.close())));

describe("content generation pipeline", () => {
  it("counts only unselected approved content dated today or later in Madrid", async () => {
    const { client, database } = await setup();
    const dates = ["2026-07-31", "2026-08-01", "2026-08-02"];
    const types = ["quiz", "quiz", "crossword"] as const;
    for (const [index, targetDate] of dates.entries()) {
      const jobId = `10000000-0000-4000-8000-00000000000${index + 1}`;
      const contentId = `20000000-0000-4000-8000-00000000000${index + 1}`;
      await database.query(
        `insert into content_generation_jobs (id, content_type, target_date, provider)
         values ($1, $2, $3, 'fake')`,
        [jobId, types[index], targetDate],
      );
      await database.query(
        `insert into generated_contents
           (id, generation_job_id, content_type, target_date, status, public_payload,
            private_payload, sources, content_hash)
         values ($1, $2, $3, $4, 'approved', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, $5)`,
        [contentId, jobId, types[index], targetDate, `hash-${index}`],
      );
    }

    expect(await getAdminContentCalendar(client, new Date("2026-08-01T10:00:00Z"))).toMatchObject({
      reserve: { crossword: 1, quiz: 1 },
    });
  });

  it("plans idempotently, validates playable games and assembles an approved edition", async () => {
    const { client, database } = await setup();
    const firstPlan = await planContentGenerationJobs(client, "2026-08-03", 1, "fake", 1_000);
    const repeated = await planContentGenerationJobs(client, "2026-08-03", 1, "other", 2_000);
    expect(firstPlan).toHaveLength(5);
    expect(repeated.map(({ id }) => id)).toEqual(firstPlan.map(({ id }) => id));

    for (const job of firstPlan.filter(
      (job) =>
        job.contentType === "quiz" ||
        job.contentType === "crossword" ||
        job.contentType === "true_false",
    )) {
      expect(await claimContentGenerationJob(client, job.id, now)).toMatchObject({ id: job.id });
      const generated = await recordGeneratedContent(
        client,
        job.id,
        job.contentType === "quiz"
          ? quizCandidate()
          : job.contentType === "crossword"
            ? crosswordCandidate()
            : trueFalseCandidate(),
        { evaluatorPassed: true, sourcesVerified: true },
        500,
        now,
      );
      expect(generated.status).toBe("approved");
    }

    const opensAt = new Date("2026-08-02T22:00:00Z");
    const closesAt = new Date("2026-08-03T22:00:00Z");
    const assembled = await assembleApprovedEdition(client, "2026-08-03", opensAt, closesAt, now);
    expect(assembled).toMatchObject({ changed: true, status: "approved" });
    expect(
      await assembleApprovedEdition(client, "2026-08-03", opensAt, closesAt, now),
    ).toMatchObject({ changed: false, editionId: assembled.editionId });

    const edition = await database.query<{ status: string }>(
      "select status from daily_editions where id = $1",
      [assembled.editionId],
    );
    expect(edition.rows[0]?.status).toBe("approved");
    const games = await database.query<{ public_payload: unknown; type: string }>(
      "select type, public_payload from games where edition_id = $1 order by type",
      [assembled.editionId],
    );
    expect(games.rows.map(({ type }) => type)).toEqual(["crossword", "quiz", "true_false"]);
    expect(JSON.stringify(games.rows)).not.toMatch(
      /correctOptionId|quiz-solution|vocabularyVersion|true-false-solution|"value":true/,
    );
    expect((await database.query("select * from game_solutions")).rows).toHaveLength(3);
  });

  it("quarantines sensitive content and prevents overriding deterministic failures", async () => {
    const { client, database } = await setup();
    const jobs = await planContentGenerationJobs(client, "2026-08-04", 1, "fake", 100);
    const quizJob = jobs.find(({ contentType }) => contentType === "quiz")!;
    await claimContentGenerationJob(client, quizJob.id, now);
    const candidate = quizCandidate("Historia del diagnóstico médico");
    const generated = await recordGeneratedContent(
      client,
      quizJob.id,
      candidate,
      { evaluatorPassed: false, sourcesVerified: true },
      0,
      now,
    );
    expect(generated.status).toBe("pending_review");
    expect(
      await reviewGeneratedContent(
        client,
        generated.id,
        "approved",
        "editor-1",
        "Fuentes comprobadas manualmente",
        "review-1",
        now,
      ),
    ).toEqual({ changed: true, status: "approved" });

    const crosswordJob = jobs.find(({ contentType }) => contentType === "crossword")!;
    await database.query(
      "insert into blocked_terms (normalized_term, reason) values ('oscuridad', 'test')",
    );
    await claimContentGenerationJob(client, crosswordJob.id, now);
    const rejected = await recordGeneratedContent(
      client,
      crosswordJob.id,
      crosswordCandidate(),
      { evaluatorPassed: true, sourcesVerified: true },
      0,
      now,
    );
    expect(rejected.status).toBe("rejected");
    await expect(
      reviewGeneratedContent(
        client,
        rejected.id,
        "approved",
        "editor-1",
        "No debe saltarse",
        "review-2",
        now,
      ),
    ).rejects.toEqual(new ContentPipelineError("VALIDATION_FAILED"));
    expect(
      await regenerateGeneratedContent(
        client,
        rejected.id,
        "editor-1",
        "Solicitar una alternativa editorial segura",
        "regenerate-1",
        now,
      ),
    ).toEqual({ changed: true, jobId: crosswordJob.id, status: "queued" });
    expect(
      await regenerateGeneratedContent(
        client,
        rejected.id,
        "editor-1",
        "Reintento idempotente de regeneración",
        "regenerate-2",
        now,
      ),
    ).toEqual({ changed: false, jobId: crosswordJob.id, status: "queued" });
  });

  it("rejects semantic duplicates from non-fake providers", async () => {
    const { client } = await setup();
    const firstJobs = await planContentGenerationJobs(client, "2026-08-06", 1, "primary", 100);
    const firstJob = firstJobs.find(({ contentType }) => contentType === "quiz")!;
    await claimContentGenerationJob(client, firstJob.id, now);
    expect(
      await recordGeneratedContent(
        client,
        firstJob.id,
        quizCandidate("Cultura general diaria"),
        { evaluatorPassed: true, sourcesVerified: true },
        0,
        now,
      ),
    ).toMatchObject({ status: "approved" });

    const secondJobs = await planContentGenerationJobs(client, "2026-08-07", 1, "primary", 100);
    const secondJob = secondJobs.find(({ contentType }) => contentType === "quiz")!;
    await claimContentGenerationJob(client, secondJob.id, now);
    const duplicate = quizCandidate("Cultura general diaria actualizada");
    const rejected = await recordGeneratedContent(
      client,
      secondJob.id,
      duplicate,
      { evaluatorPassed: true, sourcesVerified: true },
      0,
      now,
    );
    expect(rejected.status).toBe("rejected");
    expect(rejected.findings).toContainEqual({ code: "SEMANTIC_DUPLICATE" });
  });

  it("creates an audited immutable revision and rolls back invalid manual edits", async () => {
    const { client, database } = await setup();
    const jobs = await planContentGenerationJobs(client, "2026-08-05", 1, "fake", 100);
    const quizJob = jobs.find(({ contentType }) => contentType === "quiz")!;
    await claimContentGenerationJob(client, quizJob.id, now);
    const original = await recordGeneratedContent(
      client,
      quizJob.id,
      quizCandidate("Quiz original"),
      { evaluatorPassed: false, sourcesVerified: true },
      0,
      now,
    );
    const edited = quizCandidate("Quiz revisado");
    const revision = await reviseGeneratedContent(
      client,
      original.id,
      edited,
      "editor-1",
      "Corrección editorial documentada",
      "revision-1",
      now,
    );

    expect(revision).toMatchObject({
      status: "pending_review",
      publicPayload: edited.publicPayload,
    });
    expect(revision.id).not.toBe(original.id);
    expect(
      (
        await database.query<{ id: string; status: string }>(
          "select id, status from generated_contents order by created_at, id",
        )
      ).rows,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: original.id, status: "rejected" }),
        expect.objectContaining({ id: revision.id, status: "pending_review" }),
      ]),
    );
    expect(
      (
        await database.query<{ metadata: { previousContentId?: string } }>(
          "select metadata from audit_logs where action = 'revise'",
        )
      ).rows[0]?.metadata,
    ).toEqual({ previousContentId: original.id });

    await expect(
      reviseGeneratedContent(
        client,
        revision.id,
        { privatePayload: {}, publicPayload: {}, sources: [] },
        "editor-1",
        "Edición deliberadamente inválida",
        "revision-2",
        now,
      ),
    ).rejects.toEqual(new ContentPipelineError("VALIDATION_FAILED"));
    expect(
      (
        await database.query<{ status: string }>(
          "select status from generated_contents where id = $1",
          [revision.id],
        )
      ).rows[0]?.status,
    ).toBe("pending_review");
  });

  it("normalizes, audits and deactivates blocked terms", async () => {
    const { client, database } = await setup();
    const blocked = await upsertBlockedTerm(
      client,
      "  Oscuridad  ",
      "Término no permitido por política editorial",
      "moderator-1",
      "blocked-1",
      now,
    );
    expect(blocked).toMatchObject({ active: true, normalizedTerm: "oscuridad" });
    expect(await listBlockedTerms(client)).toEqual([blocked]);
    expect(
      await deactivateBlockedTerm(
        client,
        blocked.id,
        "Revisión editorial completada",
        "moderator-1",
        "blocked-2",
        now,
      ),
    ).toEqual({ active: false, changed: true, id: blocked.id });
    expect(
      await deactivateBlockedTerm(
        client,
        blocked.id,
        "Reintento seguro de desactivación",
        "moderator-1",
        "blocked-3",
        now,
      ),
    ).toEqual({ active: false, changed: false, id: blocked.id });
    expect((await listBlockedTerms(client))[0]).toMatchObject({ active: false });
    expect(
      (
        await database.query<{ action: string }>(
          "select action from audit_logs where target_type = 'BlockedTerm' order by occurred_at",
        )
      ).rows,
    ).toEqual([{ action: "block_term" }, { action: "unblock_term" }]);
  });
});

async function setup() {
  const database = new PGlite();
  databases.push(database);
  await migrate(drizzle(database), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  return { client: new PGliteClient(database), database };
}

function quizCandidate(title = "Quiz de cultura"): GeneratedContentCandidate {
  const questions: QuizPublicPayload["questions"] = Array.from({ length: 5 }, (_, index) => ({
    id: `40000000-0000-4000-8000-00000000000${index}`,
    prompt: `Pregunta ${index + 1}`,
    category: "Cultura",
    difficulty: "easy" as const,
    options: Array.from({ length: 4 }, (_, option) => ({
      id: `50000000-0000-4000-8000-0000000000${index}${option}`,
      text: `Opción ${option + 1}`,
    })),
  }));
  return {
    type: "quiz",
    publicPayload: { kind: "quiz", questions, title },
    privatePayload: {
      kind: "quiz-solution",
      questions: questions.map((question) => ({
        correctOptionId: question.options[questions.indexOf(question) % 4]!.id,
        explanation: "Explicación documentada.",
        questionId: question.id,
      })),
    },
    sources: questions.map((question) => ({
      itemId: question.id,
      url: `https://example.com/${question.id}`,
    })),
  };
}

function crosswordCandidate(): GeneratedContentCandidate {
  const crossword: CrosswordPublicPayload = {
    blocks: [
      { column: 1, row: 1 },
      { column: 2, row: 1 },
    ],
    cells: [
      cell(0, 0, 0, 1),
      cell(1, 0, 1),
      cell(2, 0, 2),
      cell(3, 1, 0),
      cell(4, 2, 0, 2),
      cell(5, 2, 1),
      cell(6, 2, 2),
    ],
    columns: 3,
    entries: [
      entry(1, "Astro que ilumina el día", "across", [0, 1, 2]),
      entry(2, "Condimento mineral", "down", [0, 3, 4], 1),
      entry(3, "Lo contrario de oscuridad", "across", [4, 5, 6], 2),
    ],
    kind: "crossword",
    rows: 3,
    rules: { accentPolicy: "fold" },
    title: "Crucigrama de cultura",
  };
  return {
    type: "crossword",
    publicPayload: crossword,
    privatePayload: {
      entries: [
        { answer: "SOL", entryId: crossword.entries[0]!.id },
        { answer: "SAL", entryId: crossword.entries[1]!.id },
        { answer: "LUZ", entryId: crossword.entries[2]!.id },
      ],
      kind: "crossword-solution",
      uniqueness: { alternativeCount: 1, vocabularyVersion: "test-v1" },
    },
    sources: crossword.entries.map((item) => ({
      itemId: item.id,
      url: `https://example.com/${item.id}`,
    })),
  };
}

function trueFalseCandidate(): GeneratedContentCandidate {
  const items = [
    {
      id: "60000000-0000-4000-8000-000000000001",
      statement: "La Tierra gira alrededor del Sol.",
      value: true,
    },
    {
      id: "60000000-0000-4000-8000-000000000002",
      statement: "La Luna es un planeta del sistema solar.",
      value: false,
    },
    {
      id: "60000000-0000-4000-8000-000000000003",
      statement: "El agua contiene hidrogeno y oxigeno.",
      value: true,
    },
    {
      id: "60000000-0000-4000-8000-000000000004",
      statement: "Los murcielagos son mamiferos nocturnos.",
      value: true,
    },
    {
      id: "60000000-0000-4000-8000-000000000005",
      statement: "El Sol gira alrededor de la Tierra cada dia.",
      value: false,
    },
  ] as const;
  return {
    type: "true_false",
    publicPayload: {
      items: items.map(({ id, statement }) => ({
        category: "Ciencia",
        difficulty: 1 as const,
        id,
        statement,
      })),
      kind: "true-false",
      title: "Verdadero o falso de ciencia",
    },
    privatePayload: {
      items: items.map(({ id, value }) => ({
        explanation: "Explicacion revisada para el item de ciencia.",
        id,
        value,
      })),
      kind: "true-false-solution",
    },
    sources: items.map(({ id }) => ({ itemId: id, url: `https://example.com/${id}` })),
  };
}

function cell(index: number, row: number, column: number, number?: number) {
  return {
    column,
    id: `a0000000-0000-4000-8000-00000000000${index}`,
    ...(number ? { number } : {}),
    row,
  };
}

function entry(
  index: number,
  clue: string,
  direction: "across" | "down",
  cells: readonly number[],
  number = index,
) {
  return {
    cellIds: cells.map((cellIndex) => `a0000000-0000-4000-8000-00000000000${cellIndex}`),
    clue,
    direction,
    id: `e0000000-0000-4000-8000-00000000000${index}`,
    number,
  };
}
