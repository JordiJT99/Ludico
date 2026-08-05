import { generatedContentTypes, type GeneratedContentType } from "@ludico/domain";
import type { QueryResultRow } from "pg";
import type { SqlClient } from "./sql-client.js";

export interface ContentGenerationHealth {
  readonly alerts: readonly ContentHealthAlert[];
  readonly generatedAt: string;
  readonly healthy: boolean;
  readonly jobs: Readonly<{
    readonly failedLast24Hours: number;
    readonly latestSuccessfulAt: string | null;
    readonly queued: number;
    readonly running: number;
    readonly succeededLast24Hours: number;
  }>;
  readonly nextEdition: Readonly<{ readonly localDate: string; readonly ready: boolean }>;
  readonly reserve: Readonly<Record<GeneratedContentType, number>>;
  readonly spendMicrosToday: number;
}

export interface ContentHealthAlert {
  readonly code: "CONTENT_RESERVE_LOW" | "CONTENT_JOB_FAILURES" | "NEXT_EDITION_MISSING";
  readonly severity: "warning" | "critical" | "emergency";
}

interface ReserveRow extends QueryResultRow {
  contentType: GeneratedContentType;
  count: number | string;
}

interface JobRow extends QueryResultRow {
  failedLast24Hours: number | string;
  latestSuccessfulAt: Date | string | null;
  queued: number | string;
  running: number | string;
  succeededLast24Hours: number | string;
}

interface NextEditionRow extends QueryResultRow {
  ready: boolean;
}

interface SpendRow extends QueryResultRow {
  spendMicrosToday: number | string;
}

/**
 * Returns only operational aggregates. It deliberately has no player, answer, or future-content
 * payloads so it is safe to expose to authorised backoffice users.
 */
export async function getContentGenerationHealth(
  client: SqlClient,
  now: Date,
): Promise<ContentGenerationHealth> {
  const [reserveResult, jobsResult, nextEditionResult, spendResult] = await Promise.all([
    client.query<ReserveRow>(
      `select content_type as "contentType", count(*)::int as count
       from generated_contents
       where status = 'approved' and selected_edition_id is null
         and target_date >= (($1::timestamptz at time zone 'Europe/Madrid')::date)
       group by content_type`,
      [now],
    ),
    client.query<JobRow>(
      `select
         count(*) filter (where status = 'queued')::int as queued,
         count(*) filter (where status = 'running')::int as running,
         count(*) filter (where status = 'failed' and finished_at >= $1::timestamptz - interval '24 hours')::int as "failedLast24Hours",
         count(*) filter (where status = 'succeeded' and finished_at >= $1::timestamptz - interval '24 hours')::int as "succeededLast24Hours",
         max(finished_at) filter (where status = 'succeeded') as "latestSuccessfulAt"
       from content_generation_jobs`,
      [now],
    ),
    client.query<NextEditionRow>(
      `select exists(
         select 1 from daily_editions
         where market = 'ES'
           and local_date = (($1::timestamptz at time zone 'Europe/Madrid')::date + 1)
           and status in ('approved', 'scheduled', 'published')
       ) as ready`,
      [now],
    ),
    client.query<SpendRow>(
      `select coalesce(sum(cost_micros), 0)::int as "spendMicrosToday"
       from content_generation_jobs
       where finished_at >= (($1::timestamptz at time zone 'Europe/Madrid')::date::timestamp at time zone 'Europe/Madrid')
         and finished_at < (((($1::timestamptz at time zone 'Europe/Madrid')::date + 1)::timestamp) at time zone 'Europe/Madrid')`,
      [now],
    ),
  ]);

  const reserve = Object.fromEntries(generatedContentTypes.map((type) => [type, 0])) as Record<
    GeneratedContentType,
    number
  >;
  for (const row of reserveResult.rows) reserve[row.contentType] = Number(row.count);
  const jobs = jobsResult.rows[0]!;
  const nextEdition = {
    localDate: madridDateOffset(now, 1),
    ready: Boolean(nextEditionResult.rows[0]?.ready),
  };
  const alerts: ContentHealthAlert[] = [];
  const lowestReserve = Math.min(...Object.values(reserve));
  if (lowestReserve < 10) {
    alerts.push({
      code: "CONTENT_RESERVE_LOW",
      severity: lowestReserve < 2 ? "emergency" : lowestReserve < 5 ? "critical" : "warning",
    });
  }
  if (Number(jobs.failedLast24Hours) > 0) {
    alerts.push({ code: "CONTENT_JOB_FAILURES", severity: "warning" });
  }
  if (!nextEdition.ready) {
    alerts.push({ code: "NEXT_EDITION_MISSING", severity: "critical" });
  }

  return {
    alerts,
    generatedAt: now.toISOString(),
    healthy: alerts.every((alert) => alert.severity === "warning"),
    jobs: {
      failedLast24Hours: Number(jobs.failedLast24Hours),
      latestSuccessfulAt: jobs.latestSuccessfulAt
        ? new Date(jobs.latestSuccessfulAt).toISOString()
        : null,
      queued: Number(jobs.queued),
      running: Number(jobs.running),
      succeededLast24Hours: Number(jobs.succeededLast24Hours),
    },
    nextEdition,
    reserve,
    spendMicrosToday: Number(spendResult.rows[0]?.spendMicrosToday ?? 0),
  };
}

function madridDateOffset(now: Date, offset: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(`${value.year}-${value.month}-${value.day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
