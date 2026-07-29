import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { migrateGuestToUser } from "./accounts.js";
import { createGuestSession } from "./guests.js";
import {
  currentConsentPolicyVersion,
  getGuestConsent,
  getUserConsent,
  ingestGuestAnalytics,
  ingestUserAnalytics,
  PrivacyError,
  purgeExpiredOperationalData,
  updateGuestConsent,
} from "./privacy.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];
const now = new Date("2026-07-29T12:00:00Z");

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.close())));

describe("consent and privacy-safe analytics", () => {
  it("defaults to opt-out and stops ingestion immediately after withdrawal", async () => {
    const { client, database, token } = await setup();
    expect(await getGuestConsent(client, token, now)).toEqual({
      ads: false,
      analytics: false,
      policyVersion: currentConsentPolicyVersion,
      recordedAt: null,
    });
    expect(await ingestGuestAnalytics(client, token, [appOpened()], now)).toEqual({ accepted: 0 });

    await updateGuestConsent(
      client,
      token,
      { ads: false, analytics: true, policyVersion: currentConsentPolicyVersion },
      "web",
      now,
    );
    expect(await ingestGuestAnalytics(client, token, [appOpened()], now)).toEqual({ accepted: 1 });
    expect(await ingestGuestAnalytics(client, token, [appOpened()], now)).toEqual({ accepted: 0 });

    await updateGuestConsent(
      client,
      token,
      { ads: false, analytics: false, policyVersion: currentConsentPolicyVersion },
      "web",
      new Date("2026-07-29T12:01:00Z"),
    );
    expect(
      await ingestGuestAnalytics(
        client,
        token,
        [{ ...appOpened(), eventId: crypto.randomUUID() }],
        now,
      ),
    ).toEqual({ accepted: 0 });
    expect((await database.query("select * from analytics_events")).rows).toHaveLength(1);
    expect((await database.query("select * from consent_records")).rows).toHaveLength(2);
  });

  it("rejects properties outside the event allowlist", async () => {
    const { client, database, token } = await setup();
    await updateGuestConsent(
      client,
      token,
      { ads: false, analytics: true, policyVersion: currentConsentPolicyVersion },
      "web",
      now,
    );
    await expect(
      ingestGuestAnalytics(
        client,
        token,
        [
          appOpened(),
          {
            ...appOpened(),
            eventId: crypto.randomUUID(),
            properties: { answer: "secreto", platform: "web" },
          },
        ],
        now,
      ),
    ).rejects.toEqual(new PrivacyError("INVALID_ANALYTICS_EVENT"));
    const quarantined = await database.query<{
      event_count: number;
      reason: string;
      structural_fingerprint: string;
      subject_type: string;
    }>("select * from analytics_event_quarantine");
    expect(quarantined.rows).toEqual([
      expect.objectContaining({
        event_count: 2,
        reason: "INVALID_ANALYTICS_EVENT",
        structural_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        subject_type: "guest",
      }),
    ]);
    expect(JSON.stringify(quarantined.rows)).not.toContain("secreto");
    expect((await database.query("select * from analytics_events")).rows).toHaveLength(0);
  });

  it("accepts only pseudonymous technical context for funnel deduplication", async () => {
    const { client, token } = await setup();
    await updateGuestConsent(
      client,
      token,
      { ads: false, analytics: true, policyVersion: currentConsentPolicyVersion },
      "web",
      now,
    );
    expect(
      await ingestGuestAnalytics(
        client,
        token,
        [
          {
            eventId: crypto.randomUUID(),
            eventName: "GameStarted",
            occurredAt: now.toISOString(),
            properties: {
              attemptId: "33333333-3333-4333-8333-333333333333",
              entryPoint: "daily",
              gameId: "22222222-2222-4222-8222-222222222222",
              gameType: "quiz",
              offline: false,
              platform: "web",
            },
            schemaVersion: 1,
          },
        ],
        now,
      ),
    ).toEqual({ accepted: 1 });
  });

  it("moves the latest consent identity when a guest creates an account", async () => {
    const { client, token } = await setup();
    await updateGuestConsent(
      client,
      token,
      { ads: true, analytics: true, policyVersion: currentConsentPolicyVersion },
      "android",
      now,
    );
    const identity = {
      email: "persona@example.com",
      provider: "supabase",
      subject: "privacy-user",
    };
    const migration = await migrateGuestToUser(client, token, identity, now);
    expect(await getUserConsent(client, migration.userId)).toMatchObject({
      ads: true,
      analytics: true,
    });
    expect(
      await ingestUserAnalytics(
        client,
        migration.userId,
        [{ ...appOpened(), eventId: crypto.randomUUID() }],
        now,
      ),
    ).toEqual({ accepted: 1 });
  });

  it("purges expired raw and operational records without deleting audit evidence", async () => {
    const { client, database } = await setup();
    const old = "2025-01-01T00:00:00Z";
    const userId = "77777777-7777-4777-8777-777777777777";
    const endpointId = "88888888-8888-4888-8888-888888888888";
    await database.query(
      `insert into users (id, auth_provider, external_subject, email_normalized)
       values ($1, 'supabase', 'retention-user', 'retention@example.com')`,
      [userId],
    );
    await database.query(
      `insert into analytics_events
         (event_id, subject_type, subject_id, event_name, event_version, occurred_at, received_at,
          properties, consent_policy_version)
       values
         ('11111111-1111-4111-8111-111111111111', 'user', $1, 'AppOpened', 1, $2, $2,
          '{}'::jsonb, $3),
         ('22222222-2222-4222-8222-222222222222', 'user', $1, 'AppOpened', 1, $4, $4,
          '{}'::jsonb, $3)`,
      [userId, old, currentConsentPolicyVersion, now],
    );
    await database.query(
      `insert into analytics_event_quarantine
         (subject_type, event_count, reason, structural_fingerprint, received_at)
       values
         ('user', 1, 'INVALID_ANALYTICS_EVENT', $1, $2),
         ('guest', 2, 'INVALID_ANALYTICS_EVENT', $3, $4)`,
      ["a".repeat(64), old, "b".repeat(64), now],
    );
    await database.query(
      `insert into idempotency_records (scope, key, request_hash, expires_at)
       values ('retention', 'expired', 'hash', $1)`,
      [old],
    );
    await database.query(
      `insert into notification_endpoints
         (id, user_id, platform, token_hash, token_ciphertext)
       values ($1, $2, 'android', 'retention-hash', 'encrypted')`,
      [endpointId, userId],
    );
    await database.query(
      `insert into notification_deliveries
         (user_id, endpoint_id, edition_id, use_case, dedupe_key, status, scheduled_at, updated_at,
          deep_link)
       values ($1, $2, '99999999-9999-4999-8999-999999999999', 'edition_available',
               'retention-delivery', 'sent', $3, $3, '/')`,
      [userId, endpointId, old],
    );
    await database.query(
      `insert into outbox_events
         (aggregate_type, aggregate_id, event_type, payload, occurred_at, published_at)
       values
         ('User', $1, 'OldPublished', '{}'::jsonb, $2, $2),
         ('User', $1, 'OldPending', '{}'::jsonb, $2, null)`,
      [userId, old],
    );

    expect(await purgeExpiredOperationalData(client, now)).toEqual({
      analyticsQuarantine: 1,
      analyticsEvents: 1,
      idempotencyRecords: 1,
      notificationDeliveries: 1,
      outboxEvents: 1,
    });
    expect((await database.query("select * from analytics_events")).rows).toHaveLength(1);
    expect((await database.query("select * from analytics_event_quarantine")).rows).toHaveLength(1);
    expect((await database.query("select * from outbox_events")).rows).toHaveLength(1);
    expect(
      (
        await database.query<{ action: string }>(
          "select action from audit_logs where target_type = 'RetentionPolicy'",
        )
      ).rows,
    ).toEqual([{ action: "purge_expired_data" }]);
  });
});

function appOpened() {
  return {
    eventId: "55555555-5555-4555-8555-555555555555",
    eventName: "AppOpened" as const,
    occurredAt: now.toISOString(),
    properties: { connectivity: "online", platform: "web", source: "direct" },
    schemaVersion: 1 as const,
  };
}

async function setup() {
  const database = new PGlite();
  databases.push(database);
  await migrate(drizzle(database), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  const client = new PGliteClient(database);
  const guest = await createGuestSession(client, "web", now);
  return { client, database, token: guest.token };
}
