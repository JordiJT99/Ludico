import type {
  Leaderboard,
  LeaderboardEntry,
  LeaderboardPosition,
  PreviousResultSummary,
  StreakSummary,
  UserLeaderboardSettings,
} from "@ludico/contracts";
import { calculateStreak } from "@ludico/domain";
import type { QueryResultRow } from "pg";
import { authenticateGuestSession, GuestTokenError } from "./guests.js";
import type { SqlClient, TransactionClient } from "./sql-client.js";

type LeaderboardScope = "daily" | "game" | "weekly";
type Subject = { kind: "guest" | "user"; id: string };

interface RankingRow extends QueryResultRow {
  alias?: string;
  durationMs: number;
  points: number;
  rank: number;
  total: number;
}

export interface ShareResultData {
  readonly competitive: boolean;
  readonly gameId: string;
  readonly gameType: "crossword" | "quiz";
  readonly points: number;
}

export class LeaderboardSettingsError extends Error {
  constructor(readonly code: "INVALID_ALIAS" | "USER_NOT_FOUND") {
    super(code);
  }
}

export async function getGuestLeaderboard(
  client: SqlClient,
  scope: LeaderboardScope,
  key: string,
  guestToken: string,
  now: Date,
): Promise<Leaderboard> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new GuestTokenError();
    return readLeaderboard(transaction, scope, key, { kind: "guest", id: guest.guestSessionId });
  });
}

export async function getGuestShareResultData(
  client: SqlClient,
  attemptId: string,
  guestToken: string,
  now: Date,
): Promise<ShareResultData | null> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new GuestTokenError();
    return readShareResultData(transaction, attemptId, "guest_session_id", guest.guestSessionId);
  });
}

export function getUserShareResultData(
  client: TransactionClient,
  attemptId: string,
  userId: string,
): Promise<ShareResultData | null> {
  return readShareResultData(client, attemptId, "user_id", userId);
}

export function getUserLeaderboard(
  client: TransactionClient,
  scope: LeaderboardScope,
  key: string,
  userId: string,
): Promise<Leaderboard> {
  return readLeaderboard(client, scope, key, { kind: "user", id: userId });
}

export async function getUserStreak(
  client: TransactionClient,
  userId: string,
  today: string,
): Promise<StreakSummary> {
  const result = await client.query<{ localDate: string } & QueryResultRow>(
    `select distinct edition.local_date::text as "localDate"
     from game_attempts attempt
     join games game on game.id = attempt.game_id
     join daily_editions edition on edition.id = game.edition_id
     join scores score on score.attempt_id = attempt.id
     where attempt.user_id = $1 and attempt.status in ('accepted', 'finalized')
       and attempt.server_received_at < edition.closes_at
       and coalesce((score.breakdown->>'completed')::boolean, false)
     order by "localDate"`,
    [userId],
  );
  return calculateStreak(
    result.rows.map((row) => row.localDate),
    today,
  );
}

export async function getUserPreviousResults(
  client: TransactionClient,
  userId: string,
  now: Date,
): Promise<readonly PreviousResultSummary[]> {
  const result = await client.query<
    PreviousResultSummary & { rank: number | null; total: number | null } & QueryResultRow
  >(
    `with ranked as (
       select attempt.id as "attemptId",
              row_number() over (
                partition by attempt.game_id
                order by score.points desc, score.duration_ms asc,
                         attempt.submitted_at asc, attempt.id asc
              )::integer as rank,
              count(*) over (partition by attempt.game_id)::integer as total
       from game_attempts attempt
       join games game on game.id = attempt.game_id
       join daily_editions edition on edition.id = game.edition_id
       join scores score on score.attempt_id = attempt.id
       where edition.local_date =
               (($2::timestamptz at time zone 'Europe/Madrid')::date - 1)
         and score.competitive and attempt.status in ('accepted', 'finalized')
     )
     select attempt.id as "attemptId", score.competitive, game.id as "gameId",
            game.type as "gameType", edition.local_date::text as "localDate", score.points,
            ranked.rank, ranked.total
     from game_attempts attempt
     join games game on game.id = attempt.game_id
     join daily_editions edition on edition.id = game.edition_id
     join scores score on score.attempt_id = attempt.id
     left join ranked on ranked."attemptId" = attempt.id
     where attempt.user_id = $1
       and edition.local_date = (($2::timestamptz at time zone 'Europe/Madrid')::date - 1)
       and attempt.status in ('accepted', 'finalized')
     order by game.type`,
    [userId, now],
  );
  return result.rows.map(({ rank, total, ...row }) => ({
    ...row,
    ...(rank && total ? { rank: Number(rank), total: Number(total) } : {}),
  }));
}

export async function getUserLeaderboardSettings(
  client: TransactionClient,
  userId: string,
): Promise<UserLeaderboardSettings | null> {
  const result = await client.query<
    { alias: string | null; leaderboardOptIn: boolean } & QueryResultRow
  >(
    `select public_alias as alias, leaderboard_opt_in as "leaderboardOptIn"
     from users where id = $1 and deleted_at is null limit 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function updateUserLeaderboardSettings(
  client: SqlClient,
  userId: string,
  settings: UserLeaderboardSettings,
  now: Date,
): Promise<UserLeaderboardSettings> {
  const alias = normalizeAlias(settings.alias);
  if ((settings.alias !== null && !alias) || (settings.leaderboardOptIn && !alias)) {
    throw new LeaderboardSettingsError("INVALID_ALIAS");
  }
  return client.transaction(async (transaction) => {
    const result = await transaction.query<
      { alias: string | null; leaderboardOptIn: boolean } & QueryResultRow
    >(
      `update users
       set public_alias = $2, leaderboard_opt_in = $3, updated_at = $4, version = version + 1
       where id = $1 and deleted_at is null
       returning public_alias as alias, leaderboard_opt_in as "leaderboardOptIn"`,
      [userId, alias, settings.leaderboardOptIn, now],
    );
    const updated = result.rows[0];
    if (!updated) throw new LeaderboardSettingsError("USER_NOT_FOUND");
    await transaction.query(
      `insert into audit_logs
         (actor_type, actor_id, action, target_type, target_id, reason, correlation_id, metadata)
       values ('user', $1, 'update_leaderboard_settings', 'User', $1,
               'player preference', $2, $3::jsonb)`,
      [userId, `leaderboard-settings:${userId}:${now.toISOString()}`, JSON.stringify(updated)],
    );
    return updated;
  });
}

async function readLeaderboard(
  client: TransactionClient,
  scope: LeaderboardScope,
  key: string,
  subject: Subject,
): Promise<Leaderboard> {
  const { parameters, sql } = rankingQuery(scope, key);
  const entries = await client.query<RankingRow>(
    `${sql}
     select users.public_alias as alias, ranked."durationMs", ranked.points, ranked.rank,
            ranked.total
     from ranked join users on users.id = ranked."userId"
     where users.leaderboard_opt_in and users.public_alias is not null
       and users.deleted_at is null
     order by ranked.rank limit 100`,
    parameters,
  );
  const own = await client.query<RankingRow>(
    `${sql}
     select "durationMs", points, rank, total from ranked
     where ${subject.kind === "user" ? '"userId"' : '"guestSessionId"'} = $${parameters.length + 1}
     limit 1`,
    [...parameters, subject.id],
  );
  return {
    entries: entries.rows.map(toEntry),
    key,
    ...(own.rows[0] ? { own: toPosition(own.rows[0]) } : {}),
    scope,
  };
}

async function readShareResultData(
  client: TransactionClient,
  attemptId: string,
  subjectColumn: "guest_session_id" | "user_id",
  subjectId: string,
): Promise<ShareResultData | null> {
  const result = await client.query<ShareResultData & QueryResultRow>(
    `select game.id as "gameId", game.type as "gameType", score.points, score.competitive
     from game_attempts attempt
     join games game on game.id = attempt.game_id
     join scores score on score.attempt_id = attempt.id
     where attempt.id = $1 and attempt.${subjectColumn} = $2
       and attempt.status in ('accepted', 'finalized')
     limit 1`,
    [attemptId, subjectId],
  );
  return result.rows[0] ?? null;
}

function rankingQuery(scope: LeaderboardScope, key: string) {
  const filter =
    scope === "game"
      ? "game.id = $1::uuid"
      : scope === "daily"
        ? "edition.local_date = $1::date"
        : "edition.local_date >= $1::date and edition.local_date < $1::date + 7";
  const aggregate = scope !== "game";
  return {
    parameters: [key],
    sql: `with totals as (
            select attempt.user_id as "userId", attempt.guest_session_id as "guestSessionId",
                   ${aggregate ? "sum(score.points)::int" : "score.points"} as points,
                   ${aggregate ? "sum(score.duration_ms)::int" : "score.duration_ms"} as "durationMs",
                   ${aggregate ? "min(attempt.submitted_at)" : "attempt.submitted_at"} as "submittedAt",
                   ${aggregate ? "coalesce(attempt.user_id::text, attempt.guest_session_id::text)" : "attempt.id::text"} as "stableId"
            from game_attempts attempt
            join games game on game.id = attempt.game_id
            join daily_editions edition on edition.id = game.edition_id
            join scores score on score.attempt_id = attempt.id
            where ${filter} and score.competitive
              and attempt.status in ('accepted', 'finalized')
            ${aggregate ? "group by attempt.user_id, attempt.guest_session_id" : ""}
          ), ranked as (
            select totals.*,
                   row_number() over (
                     order by points desc, "durationMs" asc, "submittedAt" asc, "stableId" asc
                   )::int as rank,
                   count(*) over ()::int as total
            from totals
          )`,
  };
}

function normalizeAlias(value: string | null): string | null {
  if (value === null) return null;
  const alias = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return /^[\p{L}\p{N}_ -]{3,24}$/u.test(alias) ? alias : null;
}

function toEntry(row: RankingRow): LeaderboardEntry {
  return {
    alias: row.alias!,
    durationMs: Number(row.durationMs),
    points: Number(row.points),
    rank: Number(row.rank),
  };
}

function toPosition(row: RankingRow): LeaderboardPosition {
  const rank = Number(row.rank);
  const total = Number(row.total);
  return {
    durationMs: Number(row.durationMs),
    percentile: Math.max(1, Math.ceil(((total - rank + 1) / total) * 100)),
    points: Number(row.points),
    rank,
    total,
  };
}
