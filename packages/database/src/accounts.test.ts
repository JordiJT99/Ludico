import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteUserAccount,
  getUserAccountData,
  getUserIdForIdentity,
  migrateGuestToUser,
} from "./accounts.js";
import { createGuestSession, rotateGuestSession } from "./guests.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.close())));

describe("guest account migration", () => {
  it("is repeatable and keeps the strongest attempt for each game", async () => {
    const database = new PGlite();
    databases.push(database);
    await migrate(drizzle(database), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    const client = new PGliteClient(database);
    const now = new Date("2026-07-29T12:00:00Z");
    const guest = await createGuestSession(client, "web", now);
    const rotated = await rotateGuestSession(client, guest.token, new Date("2026-07-29T12:01:00Z"));
    const editionId = "11111111-1111-4111-8111-111111111111";
    const quizId = "22222222-2222-4222-8222-222222222221";
    const crosswordId = "22222222-2222-4222-8222-222222222222";
    const userId = "33333333-3333-4333-8333-333333333333";
    const guestQuizAttempt = "44444444-4444-4444-8444-444444444441";
    const userQuizAttempt = "44444444-4444-4444-8444-444444444442";
    const guestCrosswordAttempt = "44444444-4444-4444-8444-444444444443";
    const userCrosswordAttempt = "44444444-4444-4444-8444-444444444444";

    await database.query(
      `insert into daily_editions (id, local_date, status, opens_at, closes_at)
       values ($1, '2026-07-29', 'published', '2026-07-28T22:00:00Z', '2026-07-29T22:00:00Z')`,
      [editionId],
    );
    await database.query(
      `insert into games (id, edition_id, type, public_payload) values
         ($1, $3, 'quiz', '{}'::jsonb), ($2, $3, 'crossword', '{}'::jsonb)`,
      [quizId, crosswordId, editionId],
    );
    await database.query(
      `insert into users (id, auth_provider, external_subject, email_normalized)
       values ($1, 'supabase', 'subject-1', 'persona@example.com')`,
      [userId],
    );
    await database.query(
      `insert into game_attempts
         (id, game_id, guest_session_id, status, submitted_at, server_received_at)
       values ($1, $2, $3, 'accepted', $4, $4)`,
      [guestQuizAttempt, quizId, guest.guestSessionId, now],
    );
    await database.query(`insert into game_attempts (id, game_id, user_id) values ($1, $2, $3)`, [
      userQuizAttempt,
      quizId,
      userId,
    ]);
    await database.query(
      `insert into game_attempts (id, game_id, guest_session_id) values ($1, $2, $3)`,
      [guestCrosswordAttempt, crosswordId, guest.guestSessionId],
    );
    await database.query(`insert into game_attempts (id, game_id, user_id) values ($1, $2, $3)`, [
      userCrosswordAttempt,
      crosswordId,
      userId,
    ]);
    await database.query(
      `insert into crossword_cells (attempt_id, cell_id, value, elapsed_ms) values
         ($1, '55555555-5555-4555-8555-555555555551', 'A', 100),
         ($2, '55555555-5555-4555-8555-555555555551', 'A', 100),
         ($2, '55555555-5555-4555-8555-555555555552', 'B', 100)`,
      [guestCrosswordAttempt, userCrosswordAttempt],
    );

    const identity = {
      email: " Persona@Example.com ",
      provider: "supabase",
      subject: "subject-1",
    };
    expect(await migrateGuestToUser(client, rotated.token, identity, now)).toEqual({
      migratedAttempts: 1,
      userId,
    });
    expect(await migrateGuestToUser(client, rotated.token, identity, now)).toEqual({
      migratedAttempts: 0,
      userId,
    });
    expect(await getUserIdForIdentity(client, identity)).toBe(userId);

    const attempts = await database.query<{
      guest_session_id: string | null;
      id: string;
      user_id: string | null;
    }>("select id, guest_session_id, user_id from game_attempts order by game_id");
    expect(attempts.rows).toHaveLength(2);
    expect(attempts.rows).toEqual(
      expect.arrayContaining([
        { guest_session_id: null, id: guestQuizAttempt, user_id: userId },
        { guest_session_id: null, id: userCrosswordAttempt, user_id: userId },
      ]),
    );
    const sessions = await database.query<{ migrated_user_id: string; status: string }>(
      "select migrated_user_id, status from guest_sessions",
    );
    expect(sessions.rows).toEqual([
      { migrated_user_id: userId, status: "migrated" },
      { migrated_user_id: userId, status: "migrated" },
    ]);
  });

  it("exports portable account data and irreversibly removes direct identifiers", async () => {
    const database = new PGlite();
    databases.push(database);
    await migrate(drizzle(database), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    const client = new PGliteClient(database);
    const now = new Date("2026-07-29T12:00:00Z");
    const userId = "33333333-3333-4333-8333-333333333333";
    const editionId = "11111111-1111-4111-8111-111111111111";
    const gameId = "22222222-2222-4222-8222-222222222222";
    const attemptId = "44444444-4444-4444-8444-444444444444";

    await database.query(
      `insert into users
         (id, auth_provider, external_subject, email_normalized, public_alias,
          leaderboard_opt_in, created_at)
       values ($1, 'supabase', 'subject-export', 'persona@example.com', 'Persona', true, $2)`,
      [userId, now],
    );
    await database.query(
      `insert into daily_editions (id, local_date, status, opens_at, closes_at)
       values ($1, '2026-07-29', 'published', '2026-07-28T22:00:00Z',
               '2026-07-29T22:00:00Z')`,
      [editionId],
    );
    await database.query(
      `insert into games (id, edition_id, type, public_payload)
       values ($1, $2, 'quiz', '{}'::jsonb)`,
      [gameId, editionId],
    );
    await database.query(
      `insert into game_attempts
         (id, game_id, user_id, status, submitted_at, server_received_at, started_at)
       values ($1, $2, $3, 'accepted', $4, $4, $4)`,
      [attemptId, gameId, userId, now],
    );
    await database.query(
      `insert into scores (attempt_id, points, score_version, competitive, breakdown)
       values ($1, 900, 'v1', true, '{}'::jsonb)`,
      [attemptId],
    );
    await database.query(
      `insert into answers
         (attempt_id, question_id, selected_option_id, elapsed_ms)
       values ($1, '66666666-6666-4666-8666-666666666666',
               '77777777-7777-4777-8777-777777777777', 1200)`,
      [attemptId],
    );
    await database.query(
      `insert into consent_records
         (user_id, policy_version, analytics, ads, source, recorded_at)
       values ($1, '2026-07-01', true, false, 'web', $2)`,
      [userId, now],
    );
    await database.query(
      `insert into analytics_events
         (event_id, subject_type, subject_id, event_name, event_version, occurred_at, properties,
          consent_policy_version)
       values ('55555555-5555-4555-8555-555555555555', 'user', $1, 'GameCompleted', 1,
               $2, '{"gameType":"quiz"}'::jsonb, '2026-07-01')`,
      [userId, now],
    );
    await database.query(
      `insert into notification_preferences (user_id, enabled) values ($1, true)`,
      [userId],
    );

    const exported = await getUserAccountData(client, userId, now);
    expect(exported).toMatchObject({
      analyticsEvents: [{ eventName: "GameCompleted" }],
      attempts: [{ competitive: true, gameType: "quiz", points: 900 }],
      consents: [{ ads: false, analytics: true, source: "web" }],
      notificationPreferences: { enabled: true },
      profile: { alias: "Persona", email: "persona@example.com", leaderboardOptIn: true },
      quizAnswers: [{ attemptId, elapsedMs: 1200 }],
    });

    expect(await deleteUserAccount(client, userId, "account-delete-test", now)).toBe(true);
    expect(await getUserAccountData(client, userId, now)).toBeNull();
    const deleted = await database.query<{
      email_normalized: string;
      external_subject: string;
      public_alias: string | null;
    }>("select email_normalized, external_subject, public_alias from users where id = $1", [
      userId,
    ]);
    expect(deleted.rows[0]).toEqual({
      email_normalized: `deleted+${userId}@invalid.local`,
      external_subject: `deleted:${userId}`,
      public_alias: null,
    });
    expect((await database.query("select * from analytics_events")).rows).toHaveLength(0);
    expect((await database.query("select * from consent_records")).rows).toHaveLength(0);
    expect((await database.query("select * from notification_preferences")).rows).toHaveLength(0);
    expect((await database.query("select * from game_attempts")).rows).toHaveLength(1);
    expect(
      (
        await database.query<{ event_type: string }>(
          "select event_type from outbox_events where aggregate_id = $1",
          [userId],
        )
      ).rows,
    ).toContainEqual({ event_type: "UserDeletionRequested" });
  });
});
