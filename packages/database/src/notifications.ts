import type { NotificationPreferences } from "@ludico/contracts";
import {
  chooseNotificationUseCase,
  isValidTimeZone,
  isWithinNotificationCap,
  nextAllowedNotificationTime,
  type NotificationUseCase,
} from "@ludico/domain";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { SqlClient, TransactionClient } from "./sql-client.js";

const defaultPreferences: NotificationPreferences = {
  editionAvailable: true,
  enabled: false,
  previousSolution: true,
  quietEnd: "08:00",
  quietStart: "22:00",
  timeZone: "Europe/Madrid",
};

export interface PendingNotificationDelivery {
  readonly attempts: number;
  readonly deepLink: string;
  readonly id: string;
  readonly tokenCiphertext: string;
  readonly useCase: NotificationUseCase;
}

export class NotificationSettingsError extends Error {
  constructor(
    readonly code:
      | "INVALID_NOTIFICATION_PREFERENCES"
      | "INVALID_PUSH_TOKEN"
      | "PUSH_ENCRYPTION_UNAVAILABLE"
      | "USER_NOT_FOUND",
  ) {
    super(code);
  }
}

export async function getUserNotificationPreferences(
  client: SqlClient,
  userId: string,
): Promise<NotificationPreferences | null> {
  const result = await client.query<NotificationPreferences & QueryResultRow>(
    `select preference.enabled, preference.edition_available as "editionAvailable",
            preference.previous_solution as "previousSolution",
            preference.time_zone as "timeZone", preference.quiet_start as "quietStart",
            preference.quiet_end as "quietEnd"
     from users left join notification_preferences preference on preference.user_id = users.id
     where users.id = $1 and users.deleted_at is null`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return typeof row.enabled === "boolean" ? row : defaultPreferences;
}

export async function updateUserNotificationPreferences(
  client: SqlClient,
  userId: string,
  preferences: NotificationPreferences,
  now: Date,
): Promise<NotificationPreferences> {
  validatePreferences(preferences);
  return client.transaction(async (transaction) => {
    const user = await transaction.query(
      "select 1 from users where id = $1 and deleted_at is null",
      [userId],
    );
    if (!user.rows[0]) throw new NotificationSettingsError("USER_NOT_FOUND");
    await transaction.query(
      `insert into notification_preferences
         (user_id, enabled, edition_available, previous_solution, time_zone,
          quiet_start, quiet_end, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       on conflict (user_id) do update set
         enabled = excluded.enabled, edition_available = excluded.edition_available,
         previous_solution = excluded.previous_solution, time_zone = excluded.time_zone,
         quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end,
         updated_at = excluded.updated_at,
         version = notification_preferences.version + 1`,
      [
        userId,
        preferences.enabled,
        preferences.editionAvailable,
        preferences.previousSolution,
        preferences.timeZone,
        preferences.quietStart,
        preferences.quietEnd,
        now,
      ],
    );
    await transaction.query(
      `update notification_deliveries
       set status = 'cancelled', updated_at = $2, version = version + 1
       where user_id = $1 and status = 'queued'`,
      [userId, now],
    );
    await auditPreferenceChange(transaction, userId, preferences, now);
    return preferences;
  });
}

export async function registerUserPushEndpoint(
  client: SqlClient,
  userId: string,
  token: string,
  platform: "android" | "ios",
  encryptionKey: string,
  now: Date,
): Promise<{ endpointId: string }> {
  if (!/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/.test(token)) {
    throw new NotificationSettingsError("INVALID_PUSH_TOKEN");
  }
  const ciphertext = encryptPushToken(token, encryptionKey);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return client.transaction(async (transaction) => {
    const user = await transaction.query(
      "select 1 from users where id = $1 and deleted_at is null",
      [userId],
    );
    if (!user.rows[0]) throw new NotificationSettingsError("USER_NOT_FOUND");
    const result = await transaction.query<{ endpointId: string } & QueryResultRow>(
      `insert into notification_endpoints
         (user_id, provider, platform, token_hash, token_ciphertext, active,
          last_seen_at, created_at, updated_at)
       values ($1, 'expo', $2, $3, $4, true, $5, $5, $5)
       on conflict (token_hash) do update set
         user_id = excluded.user_id, platform = excluded.platform,
         token_ciphertext = excluded.token_ciphertext, active = true,
         last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at,
         version = notification_endpoints.version + 1
       returning id as "endpointId"`,
      [userId, platform, tokenHash, ciphertext, now],
    );
    await transaction.query(
      `insert into audit_logs
         (actor_type, actor_id, action, target_type, target_id, correlation_id, metadata)
       values ('user', $1, 'register_push_endpoint', 'NotificationEndpoint', $2, $2, $3::jsonb)`,
      [userId, result.rows[0]!.endpointId, JSON.stringify({ platform })],
    );
    return result.rows[0]!;
  });
}

export async function scheduleEligibleNotifications(
  client: SqlClient,
  now: Date,
): Promise<{ scheduled: number }> {
  return client.transaction(async (transaction) => {
    const localDate = dateInMadrid(now);
    const previousDate = addDays(localDate, -1);
    const context = await transaction.query<
      {
        currentEditionId: string | null;
        previousEditionId: string | null;
        previousQuizId: string | null;
      } & QueryResultRow
    >(
      `select
         (select id from daily_editions
          where market = 'ES' and local_date = $1::date and status = 'published' limit 1)
           as "currentEditionId",
         (select id from daily_editions
          where market = 'ES' and local_date = $2::date and status in ('closed','archived') limit 1)
           as "previousEditionId",
         (select game.id from games game join daily_editions edition on edition.id = game.edition_id
          where edition.market = 'ES' and edition.local_date = $2::date
            and edition.status in ('closed','archived') and game.type = 'quiz' limit 1)
           as "previousQuizId"`,
      [localDate, previousDate],
    );
    const available = context.rows[0];
    if (!available?.currentEditionId && !available?.previousEditionId) return { scheduled: 0 };

    const subjects = await transaction.query<
      NotificationPreferences & {
        endpointId: string;
        preferenceVersion: number;
        userId: string;
      } & QueryResultRow
    >(
      `select distinct on (preference.user_id)
         preference.user_id as "userId", endpoint.id as "endpointId",
         preference.version as "preferenceVersion", preference.enabled,
         preference.edition_available as "editionAvailable",
         preference.previous_solution as "previousSolution",
         preference.time_zone as "timeZone", preference.quiet_start as "quietStart",
         preference.quiet_end as "quietEnd"
       from notification_preferences preference
       join notification_endpoints endpoint on endpoint.user_id = preference.user_id and endpoint.active = true
       where preference.enabled = true
       order by preference.user_id, endpoint.last_seen_at desc`,
    );
    let scheduled = 0;
    for (const subject of subjects.rows) {
      const useCase = chooseNotificationUseCase(subject, {
        edition: Boolean(available.currentEditionId),
        previousSolution: Boolean(available.previousEditionId && available.previousQuizId),
      });
      if (!useCase) continue;
      const previous = await transaction.query<{ scheduledAt: Date | string } & QueryResultRow>(
        `select scheduled_at as "scheduledAt" from notification_deliveries
         where user_id = $1 and status in ('queued','sending','sent') and scheduled_at >= $2`,
        [subject.userId, new Date(now.getTime() - 8 * 24 * 60 * 60_000)],
      );
      if (
        !isWithinNotificationCap(
          previous.rows.map(({ scheduledAt }) => new Date(scheduledAt)),
          now,
          subject.timeZone,
        )
      ) {
        continue;
      }
      const editionId = available.currentEditionId ?? available.previousEditionId!;
      const deepLink =
        useCase === "previous_solution" ? `/resultados/${available.previousQuizId}` : "/";
      const result = await transaction.query(
        `insert into notification_deliveries
           (user_id, endpoint_id, edition_id, use_case, dedupe_key, scheduled_at,
            deep_link, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         on conflict (dedupe_key) do nothing`,
        [
          subject.userId,
          subject.endpointId,
          editionId,
          useCase,
          `${subject.userId}:${localDate}:v${subject.preferenceVersion}`,
          nextAllowedNotificationTime(now, subject),
          deepLink,
          now,
        ],
      );
      scheduled += result.rowCount ?? 0;
    }
    return { scheduled };
  });
}

export async function claimDueNotificationDeliveries(
  client: SqlClient,
  now: Date,
  limit = 100,
): Promise<readonly PendingNotificationDelivery[]> {
  return client.transaction(async (transaction) => {
    await transaction.query(
      `update notification_deliveries delivery
       set status = 'cancelled', updated_at = $1, version = version + 1
       where delivery.status = 'queued' and not exists (
         select 1 from notification_endpoints endpoint
         where endpoint.id = delivery.endpoint_id and endpoint.active = true
       )`,
      [now],
    );
    const result = await transaction.query<PendingNotificationDelivery & QueryResultRow>(
      `with due as (
         select delivery.id
         from notification_deliveries delivery
         join notification_endpoints endpoint on endpoint.id = delivery.endpoint_id and endpoint.active = true
         where delivery.status = 'queued' and delivery.scheduled_at <= $1
         order by delivery.scheduled_at
         limit $2 for update of delivery skip locked
       )
       update notification_deliveries delivery
       set status = 'sending', attempts = delivery.attempts + 1,
           updated_at = $1, version = delivery.version + 1
       from due, notification_endpoints endpoint
       where delivery.id = due.id and endpoint.id = delivery.endpoint_id
       returning delivery.id, delivery.use_case as "useCase", delivery.deep_link as "deepLink",
                 delivery.attempts, endpoint.token_ciphertext as "tokenCiphertext"`,
      [now, Math.max(1, Math.min(limit, 100))],
    );
    return result.rows;
  });
}

export async function completeNotificationDelivery(
  client: SqlClient,
  deliveryId: string,
  result:
    | { status: "sent"; providerMessageId: string }
    | { status: "failed"; errorCode: string; deactivateEndpoint?: boolean }
    | { status: "retry"; errorCode: string },
  now: Date,
): Promise<void> {
  await client.transaction(async (transaction) => {
    if (result.status === "sent") {
      await transaction.query(
        `update notification_deliveries
         set status = 'sent', sent_at = $2, provider_message_id = $3,
             error_code = null, updated_at = $2, version = version + 1
         where id = $1 and status = 'sending'`,
        [deliveryId, now, result.providerMessageId.slice(0, 200)],
      );
      return;
    }
    const current = await transaction.query<
      { attempts: number; endpointId: string } & QueryResultRow
    >(
      `select attempts, endpoint_id as "endpointId"
       from notification_deliveries where id = $1 and status = 'sending' for update`,
      [deliveryId],
    );
    const row = current.rows[0];
    if (!row) return;
    const retry = result.status === "retry" && row.attempts < 5;
    await transaction.query(
      `update notification_deliveries
       set status = $2, error_code = $3,
           scheduled_at = case when $2 = 'queued' then $4 else scheduled_at end,
           updated_at = $5, version = version + 1 where id = $1`,
      [
        deliveryId,
        retry ? "queued" : "failed",
        result.errorCode.slice(0, 80),
        new Date(now.getTime() + Math.min(60, 2 ** row.attempts) * 60_000),
        now,
      ],
    );
    if (result.status === "failed" && result.deactivateEndpoint) {
      await transaction.query(
        `update notification_endpoints
         set active = false, updated_at = $2, version = version + 1 where id = $1`,
        [row.endpointId, now],
      );
    }
  });
}

export function decryptPushToken(ciphertext: string, encryptionKey: string): string {
  const key = parseEncryptionKey(encryptionKey);
  const [ivValue, tagValue, encryptedValue] = ciphertext.split(".");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new NotificationSettingsError("PUSH_ENCRYPTION_UNAVAILABLE");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new NotificationSettingsError("PUSH_ENCRYPTION_UNAVAILABLE");
  }
}

export function isValidPushEncryptionKey(value: string | undefined): value is string {
  if (!value) return false;
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

function encryptPushToken(token: string, encryptionKey: string): string {
  const key = parseEncryptionKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString("base64url")).join(".");
}

function parseEncryptionKey(value: string): Buffer {
  if (!isValidPushEncryptionKey(value)) {
    throw new NotificationSettingsError("PUSH_ENCRYPTION_UNAVAILABLE");
  }
  return Buffer.from(value, "base64");
}

function validatePreferences(preferences: NotificationPreferences): void {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (
    !time.test(preferences.quietStart) ||
    !time.test(preferences.quietEnd) ||
    !isValidTimeZone(preferences.timeZone) ||
    (preferences.enabled && !preferences.editionAvailable && !preferences.previousSolution)
  ) {
    throw new NotificationSettingsError("INVALID_NOTIFICATION_PREFERENCES");
  }
}

async function auditPreferenceChange(
  transaction: TransactionClient,
  userId: string,
  preferences: NotificationPreferences,
  now: Date,
) {
  await transaction.query(
    `insert into audit_logs
       (actor_type, actor_id, action, target_type, target_id, correlation_id, metadata, occurred_at)
     values ('user', $1, 'update_notification_preferences', 'User', $1, $2, $3::jsonb, $4)`,
    [
      userId,
      `notification-preferences:${userId}:${now.toISOString()}`,
      JSON.stringify({
        editionAvailable: preferences.editionAvailable,
        enabled: preferences.enabled,
        previousSolution: preferences.previousSolution,
        quietEnd: preferences.quietEnd,
        quietStart: preferences.quietStart,
        timeZone: preferences.timeZone,
      }),
      now,
    ],
  );
}

function dateInMadrid(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addDays(localDate: string, offset: number): string {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}
