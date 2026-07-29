import type { QueryResultRow } from "pg";
import type { TransactionClient } from "./sql-client.js";

export interface AnalyticsDashboard {
  readonly daily: readonly {
    readonly activeSubjects: number;
    readonly completions: number;
    readonly localDate: string;
    readonly starts: number;
  }[];
  readonly definitions: Readonly<{
    activeSubjects: string;
    completionRate: string;
  }>;
  readonly freshness: string | null;
  readonly generatedAt: string;
  readonly owner: "Product/Data";
  readonly period: Readonly<{ days: number; from: string; to: string }>;
  readonly totals: Readonly<{
    activeSubjects: number;
    completionRate: number | null;
    completions: number;
    quarantinedBatches: number;
    registrations: number;
    shares: number;
    starts: number;
  }>;
}

interface AggregateRow extends QueryResultRow {
  activeSubjects: number | string;
  completions: number | string;
  freshness: Date | string | null;
  registrations: number | string;
  shares: number | string;
  starts: number | string;
}

interface DailyRow extends QueryResultRow {
  activeSubjects: number | string;
  completions: number | string;
  localDate: Date | string;
  starts: number | string;
}

interface QuarantineRow extends QueryResultRow {
  quarantinedBatches: number | string;
}

export async function getAnalyticsDashboard(
  client: TransactionClient,
  now: Date,
  days = 7,
): Promise<AnalyticsDashboard> {
  const periodDays = Math.max(1, Math.min(days, 30));
  const range = `occurred_at >= ((($1::timestamptz at time zone 'Europe/Madrid')::date
                   - ($2::integer - 1))::timestamp at time zone 'Europe/Madrid')
                 and occurred_at < (((($1::timestamptz at time zone 'Europe/Madrid')::date
                   + 1))::timestamp at time zone 'Europe/Madrid')`;
  const aggregate = await client.query<AggregateRow>(
    `select
       count(distinct case when event_name = 'AppOpened'
         then subject_type || ':' || subject_id::text end)::integer as "activeSubjects",
       count(distinct case when event_name = 'GameStarted'
         then coalesce(properties->>'attemptId', event_id::text) end)::integer as starts,
       count(distinct case when event_name = 'GameCompleted'
         then coalesce(properties->>'attemptId', event_id::text) end)::integer as completions,
       count(*) filter (where event_name = 'ShareCompleted')::integer as shares,
       count(*) filter (where event_name = 'RegistrationCompleted')::integer as registrations,
       max(received_at) as freshness
     from analytics_events where ${range}`,
    [now, periodDays],
  );
  const daily = await client.query<DailyRow>(
    `select (occurred_at at time zone 'Europe/Madrid')::date as "localDate",
       count(distinct case when event_name = 'AppOpened'
         then subject_type || ':' || subject_id::text end)::integer as "activeSubjects",
       count(distinct case when event_name = 'GameStarted'
         then coalesce(properties->>'attemptId', event_id::text) end)::integer as starts,
       count(distinct case when event_name = 'GameCompleted'
         then coalesce(properties->>'attemptId', event_id::text) end)::integer as completions
     from analytics_events where ${range}
     group by 1 order by 1`,
    [now, periodDays],
  );
  const quarantine = await client.query<QuarantineRow>(
    `select count(*)::integer as "quarantinedBatches"
     from analytics_event_quarantine
     where received_at >= ((($1::timestamptz at time zone 'Europe/Madrid')::date
             - ($2::integer - 1))::timestamp at time zone 'Europe/Madrid')
       and received_at < (((($1::timestamptz at time zone 'Europe/Madrid')::date
             + 1))::timestamp at time zone 'Europe/Madrid')`,
    [now, periodDays],
  );
  const row = aggregate.rows[0]!;
  const starts = number(row.starts);
  const completions = number(row.completions);
  const localDate = madridDate(now);
  return {
    daily: daily.rows.map((item) => ({
      activeSubjects: number(item.activeSubjects),
      completions: number(item.completions),
      localDate: date(item.localDate),
      starts: number(item.starts),
    })),
    definitions: {
      activeSubjects: "Sujetos seudónimos únicos con AppOpened en el periodo.",
      completionRate: "Intentos únicos completados / intentos únicos iniciados.",
    },
    freshness: row.freshness ? new Date(row.freshness).toISOString() : null,
    generatedAt: now.toISOString(),
    owner: "Product/Data",
    period: {
      days: periodDays,
      from: madridDateDaysAgo(now, periodDays - 1),
      to: localDate,
    },
    totals: {
      activeSubjects: number(row.activeSubjects),
      completionRate: starts ? Math.round((completions / starts) * 1_000) / 10 : null,
      completions,
      quarantinedBatches: number(quarantine.rows[0]?.quarantinedBatches ?? 0),
      registrations: number(row.registrations),
      shares: number(row.shares),
      starts,
    },
  };
}

function number(value: number | string): number {
  return Number(value);
}

function date(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function madridDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).format(value);
}

function madridDateDaysAgo(now: Date, daysAgo: number): string {
  const anchor = new Date(`${madridDate(now)}T12:00:00.000Z`);
  anchor.setUTCDate(anchor.getUTCDate() - daysAgo);
  return anchor.toISOString().slice(0, 10);
}
