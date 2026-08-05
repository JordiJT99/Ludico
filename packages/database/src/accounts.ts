import type {
  AccountDataExport,
  AnalyticsEventName,
  NotificationPreferences,
} from "@ludico/contracts";
import type { QueryResultRow } from "pg";
import { authenticateGuestSession, GuestTokenError, hashGuestToken } from "./guests.js";
import type { SqlClient, TransactionClient } from "./sql-client.js";

export interface ExternalIdentity {
  readonly email: string;
  readonly provider: string;
  readonly subject: string;
}

export interface GuestMigrationResult {
  readonly migratedAttempts: number;
  readonly userId: string;
}

export async function getUserIdForIdentity(
  client: TransactionClient,
  identity: Pick<ExternalIdentity, "provider" | "subject">,
): Promise<string | null> {
  const result = await client.query<{ id: string } & QueryResultRow>(
    `select id from users
     where auth_provider = $1 and external_subject = $2 and deleted_at is null
     limit 1`,
    [identity.provider, identity.subject],
  );
  return result.rows[0]?.id ?? null;
}

interface AttemptRow extends QueryResultRow {
  gameId: string;
  id: string;
  mode: "casual" | "competitive";
  progressCount: number;
  status: string;
  version: number;
}

export async function migrateGuestToUser(
  client: SqlClient,
  guestToken: string,
  identity: ExternalIdentity,
  now: Date,
): Promise<GuestMigrationResult> {
  return client.transaction(async (transaction) => {
    const alreadyMigrated = await findMigratedUser(transaction, guestToken);
    if (alreadyMigrated) return { migratedAttempts: 0, userId: alreadyMigrated };
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new GuestTokenError();
    const userId = await upsertUser(transaction, identity, now);
    const guestAttempts = await readAttempts(transaction, "guest_session_id", guest.guestSessionId);
    let migratedAttempts = 0;

    for (const guestAttempt of guestAttempts) {
      const userAttempt =
        guestAttempt.mode === "competitive"
          ? (await readAttempts(transaction, "user_id", userId, guestAttempt.gameId))[0]
          : undefined;
      if (userAttempt && preferFirstAttempt(userAttempt, guestAttempt)) {
        await transaction.query("delete from game_attempts where id = $1", [guestAttempt.id]);
        continue;
      }
      if (userAttempt) {
        await transaction.query("delete from game_attempts where id = $1", [userAttempt.id]);
      }
      await transaction.query(
        `update game_attempts
         set guest_session_id = null, user_id = $2, updated_at = $3, version = version + 1
         where id = $1`,
        [guestAttempt.id, userId, now],
      );
      migratedAttempts += 1;
    }

    await transaction.query(
      `update consent_records
       set guest_session_id = null, user_id = $2
       where guest_session_id = $1`,
      [guest.guestSessionId, userId],
    );

    await transaction.query(
      `with recursive lineage(id) as (
         select id from guest_sessions where id = $1
         union all
         select child.id from guest_sessions child join lineage parent on child.previous_session_id = parent.id
       )
       update guest_sessions
       set status = 'migrated', migrated_user_id = $2, updated_at = $3, version = version + 1
       where id in (select id from lineage)`,
      [guest.guestSessionId, userId, now],
    );
    const payload = { migratedAttempts, userId };
    await transaction.query(
      `insert into outbox_events (aggregate_type, aggregate_id, event_type, payload)
       values ('User', $1, 'GuestMigrated', $2::jsonb)`,
      [userId, JSON.stringify(payload)],
    );
    await transaction.query(
      `insert into audit_logs
         (actor_type, actor_id, action, target_type, target_id, reason, correlation_id, metadata)
       values ('user', $1, 'migrate_guest', 'User', $1, 'account conversion', $2, $3::jsonb)`,
      [userId, `guest-migration:${guest.guestSessionId}`, JSON.stringify(payload)],
    );
    return payload;
  });
}

function preferFirstAttempt(first: AttemptRow, second: AttemptRow): boolean {
  const firstSubmitted = first.status !== "in_progress";
  const secondSubmitted = second.status !== "in_progress";
  if (firstSubmitted !== secondSubmitted) return firstSubmitted;
  if (first.progressCount !== second.progressCount)
    return first.progressCount > second.progressCount;
  return first.version >= second.version;
}

async function readAttempts(
  transaction: TransactionClient,
  subjectColumn: "guest_session_id" | "user_id",
  subjectId: string,
  gameId?: string,
) {
  const result = await transaction.query<AttemptRow>(
    `select attempt.id, attempt.game_id as "gameId", attempt.mode, attempt.status,
            attempt.version,
            (select count(*)::int from answers where attempt_id = attempt.id) +
            (select count(*)::int from crossword_cells where attempt_id = attempt.id) +
            (select count(*)::int from word_guesses where attempt_id = attempt.id) +
            (select count(*)::int from word_search_finds where attempt_id = attempt.id)
              as "progressCount"
     from game_attempts attempt
     where attempt.${subjectColumn} = $1 ${gameId ? "and attempt.game_id = $2" : ""}
     order by attempt.created_at
     for update`,
    gameId ? [subjectId, gameId] : [subjectId],
  );
  return result.rows;
}

async function upsertUser(
  transaction: TransactionClient,
  identity: ExternalIdentity,
  now: Date,
): Promise<string> {
  const email = identity.email.trim().normalize("NFKC").toLocaleLowerCase("en-US");
  if (!email || !identity.provider.trim() || !identity.subject.trim()) {
    throw new Error("La identidad externa verificada está incompleta");
  }
  const result = await transaction.query<{ id: string } & QueryResultRow>(
    `insert into users (auth_provider, external_subject, email_normalized, updated_at)
     values ($1, $2, $3, $4)
     on conflict (auth_provider, external_subject)
     do update set email_normalized = excluded.email_normalized,
                   updated_at = excluded.updated_at,
                   version = users.version + 1
     returning id`,
    [identity.provider, identity.subject, email, now],
  );
  const user = result.rows[0];
  if (!user) throw new Error("No se pudo crear la cuenta");
  return user.id;
}

async function findMigratedUser(transaction: TransactionClient, token: string) {
  const result = await transaction.query<{ migratedUserId: string } & QueryResultRow>(
    `select migrated_user_id as "migratedUserId"
     from guest_sessions
     where token_hash = $1 and status = 'migrated' and migrated_user_id is not null
     limit 1`,
    [hashGuestToken(token)],
  );
  return result.rows[0]?.migratedUserId ?? null;
}

interface AccountProfileRow extends QueryResultRow {
  createdAt: Date | string;
  email: string;
  leaderboardOptIn: boolean;
  publicAlias: string | null;
}

interface AccountAttemptRow extends QueryResultRow {
  competitive: boolean | null;
  gameType: "crossword" | "quiz" | "true_false" | "guess_word" | "word_search";
  id: string;
  localDate: string;
  mode: "casual" | "competitive";
  points: number | null;
  startedAt: Date | string;
  status: string;
  submittedAt: Date | string | null;
}

interface AccountConsentRow extends QueryResultRow {
  ads: boolean;
  analytics: boolean;
  policyVersion: string;
  recordedAt: Date | string;
  source: "android" | "ios" | "web";
}

interface AccountAnalyticsRow extends QueryResultRow {
  eventName: AnalyticsEventName;
  occurredAt: Date | string;
  properties: Record<string, boolean | number | string>;
}

interface AccountQuizAnswerRow extends QueryResultRow {
  attemptId: string;
  elapsedMs: number;
  questionId: string;
  selectedOptionId: string;
}

interface AccountCrosswordCellRow extends QueryResultRow {
  attemptId: string;
  cellId: string;
  elapsedMs: number;
  value: string;
}

interface AccountWordGuessRow extends QueryResultRow {
  attemptId: string;
  elapsedMs: number;
  guess: string;
}

interface AccountWordSearchFindRow extends QueryResultRow {
  attemptId: string;
  elapsedMs: number;
  entryId: string;
}

type AccountNotificationRow = NotificationPreferences & QueryResultRow;

export async function getUserAccountData(
  client: TransactionClient,
  userId: string,
  now: Date,
): Promise<AccountDataExport | null> {
  const profile = await client.query<AccountProfileRow>(
    `select email_normalized as email, public_alias as "publicAlias",
            leaderboard_opt_in as "leaderboardOptIn", created_at as "createdAt"
     from users where id = $1 and deleted_at is null limit 1`,
    [userId],
  );
  const user = profile.rows[0];
  if (!user) return null;

  const [
    attempts,
    consents,
    analytics,
    quizAnswers,
    crosswordCells,
    wordGuesses,
    wordSearchFinds,
    notifications,
  ] = await Promise.all([
    client.query<AccountAttemptRow>(
      `select attempt.id, game.type as "gameType", edition.local_date as "localDate",
              attempt.mode, attempt.status, attempt.started_at as "startedAt",
              attempt.submitted_at as "submittedAt", score.points, score.competitive
       from game_attempts attempt
       join games game on game.id = attempt.game_id
       join daily_editions edition on edition.id = game.edition_id
       left join scores score on score.attempt_id = attempt.id
       where attempt.user_id = $1
       order by edition.local_date, game.type`,
      [userId],
    ),
    client.query<AccountConsentRow>(
      `select policy_version as "policyVersion", analytics, ads, source,
              recorded_at as "recordedAt"
       from consent_records where user_id = $1 order by recorded_at`,
      [userId],
    ),
    client.query<AccountAnalyticsRow>(
      `select event_name as "eventName", occurred_at as "occurredAt", properties
       from analytics_events
       where subject_type = 'user' and subject_id = $1 order by occurred_at`,
      [userId],
    ),
    client.query<AccountQuizAnswerRow>(
      `select answer.attempt_id as "attemptId", answer.question_id as "questionId",
              answer.selected_option_id as "selectedOptionId", answer.elapsed_ms as "elapsedMs"
       from answers answer join game_attempts attempt on attempt.id = answer.attempt_id
       where attempt.user_id = $1 order by answer.created_at`,
      [userId],
    ),
    client.query<AccountCrosswordCellRow>(
      `select cell.attempt_id as "attemptId", cell.cell_id as "cellId", cell.value,
              cell.elapsed_ms as "elapsedMs"
       from crossword_cells cell join game_attempts attempt on attempt.id = cell.attempt_id
       where attempt.user_id = $1 order by cell.created_at`,
      [userId],
    ),
    client.query<AccountWordGuessRow>(
      `select guess.attempt_id as "attemptId", guess.guess, guess.elapsed_ms as "elapsedMs"
         from word_guesses guess join game_attempts attempt on attempt.id = guess.attempt_id
         where attempt.user_id = $1 order by guess.created_at`,
      [userId],
    ),
    client.query<AccountWordSearchFindRow>(
      `select found.attempt_id as "attemptId", found.entry_id as "entryId",
                found.elapsed_ms as "elapsedMs"
         from word_search_finds found join game_attempts attempt on attempt.id = found.attempt_id
         where attempt.user_id = $1 order by found.created_at`,
      [userId],
    ),
    client.query<AccountNotificationRow>(
      `select enabled, edition_available as "editionAvailable",
              previous_solution as "previousSolution", time_zone as "timeZone",
              quiet_start as "quietStart", quiet_end as "quietEnd"
       from notification_preferences where user_id = $1`,
      [userId],
    ),
  ]);

  return {
    analyticsEvents: analytics.rows.map((event) => ({
      eventName: event.eventName,
      occurredAt: iso(event.occurredAt),
      properties: event.properties,
    })),
    attempts: attempts.rows.map((attempt) => ({
      ...attempt,
      startedAt: iso(attempt.startedAt),
      submittedAt: attempt.submittedAt ? iso(attempt.submittedAt) : null,
    })),
    consents: consents.rows.map((consent) => ({
      ...consent,
      recordedAt: iso(consent.recordedAt),
    })),
    crosswordCells: crosswordCells.rows,
    generatedAt: now.toISOString(),
    notificationPreferences: notifications.rows[0] ?? null,
    profile: {
      alias: user.publicAlias,
      createdAt: iso(user.createdAt),
      email: user.email,
      leaderboardOptIn: user.leaderboardOptIn,
    },
    quizAnswers: quizAnswers.rows,
    wordGuesses: wordGuesses.rows,
    wordSearchFinds: wordSearchFinds.rows,
  };
}

export async function deleteUserAccount(
  client: SqlClient,
  userId: string,
  correlationId: string,
  now: Date,
): Promise<boolean> {
  return client.transaction(async (transaction) => {
    const user = await transaction.query<{ deletedAt: Date | null } & QueryResultRow>(
      `select deleted_at as "deletedAt" from users where id = $1 for update`,
      [userId],
    );
    if (!user.rows[0] || user.rows[0].deletedAt) return false;

    await transaction.query("delete from notification_deliveries where user_id = $1", [userId]);
    await transaction.query("delete from notification_endpoints where user_id = $1", [userId]);
    await transaction.query("delete from notification_preferences where user_id = $1", [userId]);
    await transaction.query(
      "delete from analytics_events where subject_type = 'user' and subject_id = $1",
      [userId],
    );
    await transaction.query("delete from consent_records where user_id = $1", [userId]);
    await transaction.query(
      `update guest_sessions set migrated_user_id = null, updated_at = $2, version = version + 1
       where migrated_user_id = $1`,
      [userId, now],
    );
    await transaction.query(
      `update users
       set auth_provider = 'deleted', external_subject = 'deleted:' || id::text,
           email_normalized = 'deleted+' || id::text || '@invalid.local', public_alias = null,
           leaderboard_opt_in = false, deleted_at = $2, updated_at = $2, version = version + 1
       where id = $1`,
      [userId, now],
    );
    await transaction.query(
      `insert into outbox_events (aggregate_type, aggregate_id, event_type, payload, occurred_at)
       values ('User', $1, 'UserDeletionRequested', $2::jsonb, $3)`,
      [userId, JSON.stringify({ userId }), now],
    );
    await transaction.query(
      `insert into audit_logs
         (actor_type, actor_id, action, target_type, target_id, reason, correlation_id, metadata,
          occurred_at)
       values ('user', $1, 'delete_account', 'User', $1, 'data subject request', $2,
               $3::jsonb, $4)`,
      [
        userId,
        correlationId,
        JSON.stringify({ analyticsDeleted: true, identityPseudonymized: true }),
        now,
      ],
    );
    return true;
  });
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
