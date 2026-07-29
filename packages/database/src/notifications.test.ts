import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimDueNotificationDeliveries,
  completeNotificationDelivery,
  decryptPushToken,
  getUserNotificationPreferences,
  NotificationSettingsError,
  registerUserPushEndpoint,
  scheduleEligibleNotifications,
  updateUserNotificationPreferences,
} from "./notifications.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];
const userId = "77777777-7777-4777-8777-777777777777";
const key = Buffer.alloc(32, 7).toString("base64");
const token = `ExpoPushToken[${"a".repeat(32)}]`;
const now = new Date("2026-08-06T10:00:00.000Z");

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.close())));

describe("notification preferences and delivery", () => {
  it("encrypts endpoints, combines reasons, deduplicates and records delivery", async () => {
    const { client, database } = await setup();
    expect(await getUserNotificationPreferences(client, userId)).toEqual({
      editionAvailable: true,
      enabled: false,
      previousSolution: true,
      quietEnd: "08:00",
      quietStart: "22:00",
      timeZone: "Europe/Madrid",
    });
    await updateUserNotificationPreferences(
      client,
      userId,
      {
        editionAvailable: true,
        enabled: true,
        previousSolution: true,
        quietEnd: "08:00",
        quietStart: "22:00",
        timeZone: "Europe/Madrid",
      },
      now,
    );
    await registerUserPushEndpoint(client, userId, token, "android", key, now);
    const stored = await database.query<{ token_ciphertext: string }>(
      "select token_ciphertext from notification_endpoints",
    );
    expect(stored.rows[0]?.token_ciphertext).not.toContain(token);
    expect(decryptPushToken(stored.rows[0]!.token_ciphertext, key)).toBe(token);

    expect(await scheduleEligibleNotifications(client, now)).toEqual({ scheduled: 1 });
    expect(await scheduleEligibleNotifications(client, now)).toEqual({ scheduled: 0 });
    const deliveries = await claimDueNotificationDeliveries(client, now);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ attempts: 1, deepLink: "/", useCase: "daily_digest" });
    await completeNotificationDelivery(
      client,
      deliveries[0]!.id,
      { providerMessageId: "expo-ticket-1", status: "sent" },
      now,
    );
    const sent = await database.query<{ provider_message_id: string; status: string }>(
      "select status, provider_message_id from notification_deliveries",
    );
    expect(sent.rows).toEqual([{ provider_message_id: "expo-ticket-1", status: "sent" }]);
  });

  it("rejects invalid settings and cancels pending work after opt-out", async () => {
    const { client, database } = await setup();
    await expect(
      updateUserNotificationPreferences(
        client,
        userId,
        {
          editionAvailable: false,
          enabled: true,
          previousSolution: false,
          quietEnd: "08:00",
          quietStart: "22:00",
          timeZone: "Mars/Olympus",
        },
        now,
      ),
    ).rejects.toEqual(new NotificationSettingsError("INVALID_NOTIFICATION_PREFERENCES"));
    await expect(
      registerUserPushEndpoint(client, userId, "plain-token", "android", key, now),
    ).rejects.toEqual(new NotificationSettingsError("INVALID_PUSH_TOKEN"));

    const enabled = {
      editionAvailable: true,
      enabled: true,
      previousSolution: false,
      quietEnd: "08:00",
      quietStart: "22:00",
      timeZone: "Europe/Madrid",
    };
    await updateUserNotificationPreferences(client, userId, enabled, now);
    await registerUserPushEndpoint(client, userId, token, "android", key, now);
    await scheduleEligibleNotifications(client, now);
    await updateUserNotificationPreferences(
      client,
      userId,
      { ...enabled, enabled: false },
      new Date("2026-08-06T10:01:00.000Z"),
    );
    expect(
      (await database.query<{ status: string }>("select status from notification_deliveries")).rows,
    ).toEqual([{ status: "cancelled" }]);
    expect(await claimDueNotificationDeliveries(client, now)).toEqual([]);
  });
});

async function setup() {
  const database = new PGlite();
  databases.push(database);
  await migrate(drizzle(database), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  const client = new PGliteClient(database);
  await database.query(
    `insert into users (id, auth_provider, external_subject, email_normalized)
     values ($1, 'supabase', 'notification-user', 'notification@example.com')`,
    [userId],
  );
  await addEdition(database, "2026-08-05", "closed", "11111111-1111-4111-8111-111111111115");
  await addEdition(database, "2026-08-06", "published", "11111111-1111-4111-8111-111111111116");
  return { client, database };
}

async function addEdition(database: PGlite, date: string, status: string, id: string) {
  await database.query(
    `insert into daily_editions (id, local_date, status, opens_at, closes_at)
     values ($1, $2::date, $3, $2::date, $2::date + 1)`,
    [id, date, status],
  );
  await database.query(
    `insert into games (id, edition_id, type, public_payload)
     values ($1, $2, 'quiz', '{}'::jsonb)`,
    [
      date === "2026-08-05"
        ? "22222222-2222-4222-8222-222222222225"
        : "22222222-2222-4222-8222-222222222226",
      id,
    ],
  );
}
