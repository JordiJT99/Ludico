import type {
  AnalyticsEventInput,
  AnalyticsEventName,
  AnalyticsIngestResult,
  ConsentState,
} from "@ludico/contracts";
import { currentConsentPolicyVersion } from "@ludico/contracts";
import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import { authenticateGuestSession, GuestTokenError } from "./guests.js";
import type { SqlClient, TransactionClient } from "./sql-client.js";

export { currentConsentPolicyVersion };

export class PrivacyError extends Error {
  constructor(readonly code: "CONSENT_POLICY_OUTDATED" | "INVALID_ANALYTICS_EVENT") {
    super(code);
  }
}

type Subject = { kind: "guest" | "user"; id: string };

const propertiesByEvent: Readonly<Record<AnalyticsEventName, readonly string[]>> = {
  AppOpened: ["source", "connectivity", "platform"],
  DailyEditionViewed: ["localDate", "availability", "platform"],
  GameStarted: ["gameType", "entryPoint", "offline", "platform"],
  GameCompleted: ["gameType", "scoreBucket", "durationBucket", "competitive", "aidsCount"],
  ResultViewed: ["gameType", "daysAgo", "platform"],
  ShareCompleted: ["channelCategory", "result", "platform"],
  RegistrationCompleted: ["method", "entryPoint", "outcome", "platform"],
  LoginCompleted: ["method", "entryPoint", "outcome", "platform"],
};
const contextProperties = ["attemptId", "editionId", "gameId"] as const;

export async function getGuestConsent(
  client: SqlClient,
  guestToken: string,
  now: Date,
): Promise<ConsentState> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new GuestTokenError();
    return readConsent(transaction, { kind: "guest", id: guest.guestSessionId });
  });
}

export function getUserConsent(client: TransactionClient, userId: string): Promise<ConsentState> {
  return readConsent(client, { kind: "user", id: userId });
}

export async function updateGuestConsent(
  client: SqlClient,
  guestToken: string,
  choice: Pick<ConsentState, "ads" | "analytics" | "policyVersion">,
  source: "android" | "ios" | "web",
  now: Date,
): Promise<ConsentState> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new GuestTokenError();
    return writeConsent(
      transaction,
      { kind: "guest", id: guest.guestSessionId },
      choice,
      source,
      now,
    );
  });
}

export function updateUserConsent(
  client: SqlClient,
  userId: string,
  choice: Pick<ConsentState, "ads" | "analytics" | "policyVersion">,
  source: "android" | "ios" | "web",
  now: Date,
): Promise<ConsentState> {
  return client.transaction((transaction) =>
    writeConsent(transaction, { kind: "user", id: userId }, choice, source, now),
  );
}

export async function ingestGuestAnalytics(
  client: SqlClient,
  guestToken: string,
  events: readonly AnalyticsEventInput[],
  now: Date,
): Promise<AnalyticsIngestResult> {
  try {
    return await client.transaction(async (transaction) => {
      const guest = await authenticateGuestSession(transaction, guestToken, now);
      if (!guest) throw new GuestTokenError();
      return ingestAnalytics(transaction, { kind: "guest", id: guest.guestSessionId }, events, now);
    });
  } catch (error) {
    await quarantineInvalidBatch(client, "guest", events, now, error);
    throw error;
  }
}

export async function ingestUserAnalytics(
  client: SqlClient,
  userId: string,
  events: readonly AnalyticsEventInput[],
  now: Date,
): Promise<AnalyticsIngestResult> {
  try {
    return await client.transaction((transaction) =>
      ingestAnalytics(transaction, { kind: "user", id: userId }, events, now),
    );
  } catch (error) {
    await quarantineInvalidBatch(client, "user", events, now, error);
    throw error;
  }
}

export interface PrivacyRetentionResult {
  readonly analyticsQuarantine: number;
  readonly analyticsEvents: number;
  readonly idempotencyRecords: number;
  readonly notificationDeliveries: number;
  readonly outboxEvents: number;
}

export function purgeExpiredOperationalData(
  client: SqlClient,
  now: Date,
  analyticsRetentionMonths = 13,
): Promise<PrivacyRetentionResult> {
  if (analyticsRetentionMonths < 1 || analyticsRetentionMonths > 36) {
    throw new RangeError("Retención analítica fuera de rango");
  }
  return client.transaction(async (transaction) => {
    const analytics = await transaction.query(
      `delete from analytics_events
       where received_at < ($1::timestamptz - $2::integer * interval '1 month')`,
      [now, analyticsRetentionMonths],
    );
    const analyticsQuarantine = await transaction.query(
      `delete from analytics_event_quarantine
       where received_at < ($1::timestamptz - interval '30 days')`,
      [now],
    );
    const idempotency = await transaction.query(
      "delete from idempotency_records where expires_at < $1",
      [now],
    );
    const notifications = await transaction.query(
      `delete from notification_deliveries
       where status in ('sent', 'failed', 'cancelled')
         and updated_at < ($1::timestamptz - interval '90 days')`,
      [now],
    );
    const outbox = await transaction.query(
      `delete from outbox_events
       where published_at is not null and published_at < ($1::timestamptz - interval '30 days')`,
      [now],
    );
    const result = {
      analyticsQuarantine: analyticsQuarantine.rowCount ?? 0,
      analyticsEvents: analytics.rowCount ?? 0,
      idempotencyRecords: idempotency.rowCount ?? 0,
      notificationDeliveries: notifications.rowCount ?? 0,
      outboxEvents: outbox.rowCount ?? 0,
    };
    await transaction.query(
      `insert into audit_logs
         (actor_type, action, target_type, target_id, reason, correlation_id, metadata,
          occurred_at)
       values ('system', 'purge_expired_data', 'RetentionPolicy', 'operational',
               'scheduled retention', $1, $2::jsonb, $3)`,
      [`retention:${now.toISOString().slice(0, 10)}`, JSON.stringify(result), now],
    );
    return result;
  });
}

async function quarantineInvalidBatch(
  client: SqlClient,
  subjectType: Subject["kind"],
  events: readonly AnalyticsEventInput[],
  now: Date,
  error: unknown,
): Promise<void> {
  if (!(error instanceof PrivacyError) || error.code !== "INVALID_ANALYTICS_EVENT") return;
  const structure = events.map((event) => ({
    eventName: propertiesByEvent[event.eventName] ? event.eventName : "unknown",
    properties: Object.entries(event.properties)
      .map(([key, value]) => ({
        key:
          propertiesByEvent[event.eventName]?.includes(key) ||
          contextProperties.includes(key as (typeof contextProperties)[number])
            ? key
            : "unknown",
        type: typeof value,
      }))
      .sort((left, right) => left.key.localeCompare(right.key)),
    schemaVersion: event.schemaVersion,
  }));
  const fingerprint = createHash("sha256").update(JSON.stringify(structure)).digest("hex");
  await client.query(
    `insert into analytics_event_quarantine
       (subject_type, event_count, reason, structural_fingerprint, received_at)
     values ($1, $2, 'INVALID_ANALYTICS_EVENT', $3, $4)`,
    [subjectType, events.length, fingerprint, now],
  );
}

async function readConsent(client: TransactionClient, subject: Subject): Promise<ConsentState> {
  const column = subject.kind === "guest" ? "guest_session_id" : "user_id";
  const result = await client.query<
    {
      ads: boolean;
      analytics: boolean;
      policyVersion: string;
      recordedAt: Date | string;
    } & QueryResultRow
  >(
    `select ads, analytics, policy_version as "policyVersion", recorded_at as "recordedAt"
     from consent_records where ${column} = $1 order by recorded_at desc, id desc limit 1`,
    [subject.id],
  );
  const row = result.rows[0];
  return row
    ? { ...row, recordedAt: new Date(row.recordedAt).toISOString() }
    : {
        ads: false,
        analytics: false,
        policyVersion: currentConsentPolicyVersion,
        recordedAt: null,
      };
}

async function writeConsent(
  client: TransactionClient,
  subject: Subject,
  choice: Pick<ConsentState, "ads" | "analytics" | "policyVersion">,
  source: "android" | "ios" | "web",
  now: Date,
): Promise<ConsentState> {
  if (choice.policyVersion !== currentConsentPolicyVersion) {
    throw new PrivacyError("CONSENT_POLICY_OUTDATED");
  }
  const column = subject.kind === "guest" ? "guest_session_id" : "user_id";
  await client.query(
    `insert into consent_records (${column}, policy_version, analytics, ads, source, recorded_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [subject.id, choice.policyVersion, choice.analytics, choice.ads, source, now],
  );
  return { ...choice, recordedAt: now.toISOString() };
}

async function ingestAnalytics(
  client: TransactionClient,
  subject: Subject,
  events: readonly AnalyticsEventInput[],
  now: Date,
): Promise<AnalyticsIngestResult> {
  const consent = await readConsent(client, subject);
  if (!consent.analytics || consent.policyVersion !== currentConsentPolicyVersion) {
    return { accepted: 0 };
  }
  let accepted = 0;
  for (const event of events) {
    assertSafeEvent(event, now);
    const result = await client.query(
      `insert into analytics_events
         (event_id, subject_type, subject_id, event_name, event_version, occurred_at,
          received_at, properties, consent_policy_version)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       on conflict (event_id) do nothing`,
      [
        event.eventId,
        subject.kind,
        subject.id,
        event.eventName,
        event.schemaVersion,
        event.occurredAt,
        now,
        JSON.stringify(event.properties),
        consent.policyVersion,
      ],
    );
    accepted += result.rowCount ?? 0;
  }
  return { accepted };
}

function assertSafeEvent(event: AnalyticsEventInput, now: Date): void {
  const allowed = propertiesByEvent[event.eventName];
  const occurredAt = Date.parse(event.occurredAt);
  if (
    !allowed ||
    !Number.isFinite(occurredAt) ||
    occurredAt > now.getTime() + 5 * 60_000 ||
    occurredAt < now.getTime() - 30 * 24 * 60 * 60_000
  ) {
    throw new PrivacyError("INVALID_ANALYTICS_EVENT");
  }
  for (const [key, value] of Object.entries(event.properties)) {
    if (
      (!allowed.includes(key) &&
        !contextProperties.includes(key as (typeof contextProperties)[number])) ||
      (typeof value === "string" && value.length > 64)
    ) {
      throw new PrivacyError("INVALID_ANALYTICS_EVENT");
    }
  }
}
