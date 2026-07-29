import { foldCrosswordLetter, type WordBankEntry } from "@ludico/domain";
import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { SqlClient, TransactionClient } from "./sql-client.js";

export interface WordBankRecord extends WordBankEntry {
  readonly active: boolean;
  readonly category: string;
  readonly difficulty: number;
  readonly letterCount: number;
  readonly locale: string;
  readonly qualityScore: number;
  readonly sourceCheckedAt: string;
  readonly validationStatus: "approved" | "pending" | "rejected";
  readonly variants: readonly string[];
}

interface WordBankRow extends QueryResultRow {
  active: boolean;
  answer: string;
  category: string;
  clue: string;
  difficulty: number;
  id: string;
  letterCount: number;
  locale: string;
  qualityScore: number;
  sourceCheckedAt: Date | string;
  sourceUrl: string;
  validationStatus: "approved" | "pending" | "rejected";
  variants: unknown;
}

export class WordBankError extends Error {
  constructor(readonly code: "ENTRY_NOT_FOUND" | "INVALID_ENTRY" | "INVALID_REASON") {
    super(code);
  }
}

export async function listCuratedWordBank(
  client: TransactionClient,
  now: Date,
  locale = "es-ES",
  limit = 500,
): Promise<readonly WordBankRecord[]> {
  const result = await client.query<WordBankRow>(
    `select id, locale, answer, clue, category, difficulty, letter_count as "letterCount",
            variants, source_url as "sourceUrl", source_checked_at as "sourceCheckedAt",
            validation_status as "validationStatus", quality_score as "qualityScore", active
     from word_bank_entries
     where locale = $1 and active = true and validation_status = 'approved' and quality_score >= 70
       and source_checked_at between ($2::timestamptz - interval '1 year') and $2
     order by quality_score desc, normalized_answer, clue_hash
     limit $3`,
    [locale, now, Math.max(1, Math.min(limit, 2_000))],
  );
  return result.rows.map(toRecord);
}

export async function upsertWordBankEntry(
  client: SqlClient,
  input: Readonly<{
    answer: string;
    category: string;
    clue: string;
    difficulty: number;
    locale?: string;
    qualityScore: number;
    sourceCheckedAt: Date;
    sourceUrl: string;
    validationStatus: "approved" | "pending" | "rejected";
    variants: readonly string[];
  }>,
  actorId: string,
  reason: string,
  correlationId: string,
  now: Date,
): Promise<WordBankRecord> {
  const validated = validateInput(input, reason, now);
  return client.transaction(async (transaction) => {
    const result = await transaction.query<WordBankRow>(
      `insert into word_bank_entries
         (locale, answer, normalized_answer, clue, clue_hash, category, difficulty, letter_count,
          variants, source_url, source_checked_at, validation_status, quality_score, active,
          created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, true, $14, $14)
       on conflict (locale, normalized_answer, clue_hash) where active = true
       do update set answer = excluded.answer, clue = excluded.clue,
                     category = excluded.category, difficulty = excluded.difficulty,
                     letter_count = excluded.letter_count, variants = excluded.variants,
                     source_url = excluded.source_url,
                     source_checked_at = excluded.source_checked_at,
                     validation_status = excluded.validation_status,
                     quality_score = excluded.quality_score,
                     updated_at = excluded.updated_at, version = word_bank_entries.version + 1
       returning id, locale, answer, clue, category, difficulty, letter_count as "letterCount",
                 variants, source_url as "sourceUrl", source_checked_at as "sourceCheckedAt",
                 validation_status as "validationStatus", quality_score as "qualityScore", active`,
      [
        validated.locale,
        validated.answer,
        validated.normalizedAnswer,
        validated.clue,
        validated.clueHash,
        validated.category,
        validated.difficulty,
        validated.letterCount,
        JSON.stringify(validated.variants),
        validated.sourceUrl,
        validated.sourceCheckedAt,
        validated.validationStatus,
        validated.qualityScore,
        now,
      ],
    );
    const entry = toRecord(result.rows[0]!);
    await recordChange(
      transaction,
      entry.id,
      actorId,
      "upsert_word_bank_entry",
      reason,
      correlationId,
      {
        locale: entry.locale,
        qualityScore: entry.qualityScore,
        validationStatus: entry.validationStatus,
      },
    );
    return entry;
  });
}

export async function deactivateWordBankEntry(
  client: SqlClient,
  id: string,
  actorId: string,
  reason: string,
  correlationId: string,
  now: Date,
): Promise<{ active: false; changed: boolean; id: string }> {
  if (reason.trim().length < 10) throw new WordBankError("INVALID_REASON");
  return client.transaction(async (transaction) => {
    const exists = await transaction.query<{ active: boolean } & QueryResultRow>(
      "select active from word_bank_entries where id = $1 for update",
      [id],
    );
    const entry = exists.rows[0];
    if (!entry) throw new WordBankError("ENTRY_NOT_FOUND");
    if (!entry.active) return { active: false, changed: false, id };
    await transaction.query(
      `update word_bank_entries
       set active = false, updated_at = $2, version = version + 1 where id = $1`,
      [id, now],
    );
    await recordChange(
      transaction,
      id,
      actorId,
      "deactivate_word_bank_entry",
      reason,
      correlationId,
    );
    return { active: false, changed: true, id };
  });
}

function validateInput(
  input: Readonly<{
    answer: string;
    category: string;
    clue: string;
    difficulty: number;
    locale?: string;
    qualityScore: number;
    sourceCheckedAt: Date;
    sourceUrl: string;
    validationStatus: "approved" | "pending" | "rejected";
    variants: readonly string[];
  }>,
  reason: string,
  now: Date,
) {
  if (reason.trim().length < 10) throw new WordBankError("INVALID_REASON");
  const answer = input.answer.trim().normalize("NFC").toLocaleUpperCase("es-ES");
  const normalizedAnswer = foldCrosswordLetter(answer);
  const clue = input.clue.trim().replace(/\s+/g, " ");
  const category = input.category.trim().replace(/\s+/g, " ");
  const locale = input.locale?.trim() || "es-ES";
  const sourceCheckedAt = input.sourceCheckedAt;
  const variants = input.variants.map((variant) =>
    variant.trim().normalize("NFC").toLocaleUpperCase("es-ES"),
  );
  if (
    Array.from(normalizedAnswer).length < 2 ||
    Array.from(normalizedAnswer).length > 21 ||
    !/^\p{L}+$/u.test(normalizedAnswer) ||
    clue.length < 3 ||
    clue.length > 240 ||
    category.length < 2 ||
    category.length > 80 ||
    locale !== "es-ES" ||
    !Number.isInteger(input.difficulty) ||
    input.difficulty < 1 ||
    input.difficulty > 5 ||
    !["approved", "pending", "rejected"].includes(input.validationStatus) ||
    variants.length > 10 ||
    variants.some(
      (variant) =>
        variant.length < 2 ||
        variant.length > 21 ||
        !/^\p{L}+$/u.test(foldCrosswordLetter(variant)),
    ) ||
    !Number.isInteger(input.qualityScore) ||
    input.qualityScore < 0 ||
    input.qualityScore > 100 ||
    !Number.isFinite(sourceCheckedAt.getTime()) ||
    sourceCheckedAt > now ||
    sourceCheckedAt < new Date(now.getTime() - 366 * 24 * 60 * 60 * 1_000) ||
    !isHttps(input.sourceUrl)
  ) {
    throw new WordBankError("INVALID_ENTRY");
  }
  return {
    answer,
    category,
    clue,
    clueHash: createHash("sha256").update(normalizeClue(clue)).digest("hex"),
    locale,
    difficulty: input.difficulty,
    letterCount: Array.from(normalizedAnswer).length,
    normalizedAnswer,
    qualityScore: input.qualityScore,
    sourceCheckedAt,
    sourceUrl: input.sourceUrl,
    validationStatus: input.validationStatus,
    variants,
  };
}

async function recordChange(
  transaction: TransactionClient,
  id: string,
  actorId: string,
  action: string,
  reason: string,
  correlationId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await transaction.query(
    `insert into outbox_events (aggregate_type, aggregate_id, event_type, payload)
     values ('WordBankEntry', $1, $2, $3::jsonb)`,
    [
      id,
      action === "upsert_word_bank_entry" ? "WordBankEntryCurated" : "WordBankEntryDeactivated",
      JSON.stringify({ reason, ...metadata }),
    ],
  );
  await transaction.query(
    `insert into audit_logs
       (actor_type, actor_id, action, target_type, target_id, reason, correlation_id, metadata)
     values ('admin', $1, $2, 'WordBankEntry', $3, $4, $5, $6::jsonb)`,
    [actorId, action, id, reason.trim(), correlationId, JSON.stringify(metadata)],
  );
}

function toRecord(row: WordBankRow): WordBankRecord {
  return {
    ...row,
    sourceCheckedAt: new Date(row.sourceCheckedAt).toISOString(),
    variants: Array.isArray(row.variants) ? row.variants.filter(isString) : [],
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function normalizeClue(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-ES");
}

function isHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
