import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createGuestSession, rotateGuestSession } from "./guests.js";
import { migrateGuestToUser } from "./accounts.js";
import { getGuestAttemptReview, getUserAttemptReview } from "./reviews.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.close())));

describe("guest attempt review", () => {
  it("stays locked until close and returns only the owner's progress", async () => {
    const database = new PGlite();
    databases.push(database);
    await migrate(drizzle(database), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    const client = new PGliteClient(database);
    const now = new Date("2026-07-29T12:00:00Z");
    const guest = await createGuestSession(client, "web", now);
    const stranger = await createGuestSession(client, "web", now);
    const editionId = "11111111-1111-4111-8111-111111111111";
    const gameId = "22222222-2222-4222-8222-222222222222";
    const attemptId = "33333333-3333-4333-8333-333333333333";
    const questionId = "44444444-4444-4444-8444-444444444444";
    const optionId = "55555555-5555-4555-8555-555555555555";

    await database.query(
      `insert into daily_editions (id, local_date, status, opens_at, closes_at)
       values ($1, '2026-07-29', 'published', '2026-07-28T22:00:00Z', '2026-07-29T22:00:00Z')`,
      [editionId],
    );
    await database.query(
      `insert into games (id, edition_id, type, public_payload)
       values ($1, $2, 'quiz', '{"kind":"quiz","title":"Quiz","questions":[]}'::jsonb)`,
      [gameId, editionId],
    );
    await database.query(
      `insert into game_solutions (game_id, private_payload) values ($1, $2::jsonb)`,
      [
        gameId,
        JSON.stringify({
          kind: "quiz-solution",
          questions: [{ correctOptionId: optionId, explanation: "Porque sí", questionId }],
        }),
      ],
    );
    await database.query(
      `insert into game_attempts
         (id, game_id, guest_session_id, status, submitted_at, server_received_at)
       values ($1, $2, $3, 'accepted', $4, $4)`,
      [attemptId, gameId, guest.guestSessionId, now],
    );
    await database.query(
      `insert into answers (attempt_id, question_id, selected_option_id, elapsed_ms)
       values ($1, $2, $3, 1200)`,
      [attemptId, questionId, optionId],
    );
    await database.query(
      `insert into scores (attempt_id, points, score_version, competitive, breakdown)
       values ($1, 125, 'quiz-v1', true, '{}'::jsonb)`,
      [attemptId],
    );

    expect(await getGuestAttemptReview(client, attemptId, guest.token, now)).toEqual({
      status: "locked",
    });
    expect(await getGuestAttemptReview(client, attemptId, stranger.token, now)).toEqual({
      status: "not_found",
    });
    const rotated = await rotateGuestSession(client, guest.token, new Date("2026-07-29T13:00:00Z"));

    await database.query(
      `update daily_editions set status = 'closed', closed_at = $2 where id = $1`,
      [editionId, "2026-07-29T22:00:00Z"],
    );
    await database.query(
      `update game_solutions
       set public_payload = jsonb_build_object(
             'kind', 'quiz-solution', 'questions', private_payload -> 'questions'
           ), published_at = $1
       where game_id = $2`,
      ["2026-07-29T22:00:00Z", gameId],
    );
    const available = await getGuestAttemptReview(
      client,
      attemptId,
      rotated.token,
      new Date("2026-07-29T22:00:01Z"),
    );
    expect(available).toMatchObject({
      status: "available",
      review: {
        attemptId,
        progress: { answers: [{ questionId, selectedOptionId: optionId }], kind: "quiz-progress" },
        score: { competitive: true, points: 125, scoreVersion: "quiz-v1" },
      },
    });
    const migrated = await migrateGuestToUser(
      client,
      rotated.token,
      { email: "persona@example.com", provider: "supabase", subject: "review-user" },
      new Date("2026-07-29T22:00:02Z"),
    );
    expect(
      await getUserAttemptReview(
        client,
        attemptId,
        migrated.userId,
        new Date("2026-07-29T22:00:03Z"),
      ),
    ).toMatchObject({ status: "available", review: { attemptId } });
  });
});
