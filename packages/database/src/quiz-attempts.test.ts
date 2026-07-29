import type { QuizPublicPayload } from "@ludico/contracts";
import type { QuizPrivateSolution } from "@ludico/domain";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createGuestSession } from "./guests.js";
import {
  saveGuestQuizProgress,
  saveUserQuizProgress,
  startGuestQuizAttempt,
  startUserQuizAttempt,
  submitGuestQuizAttempt,
  submitUserQuizAttempt,
} from "./quiz-attempts.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];
const editionId = "11111111-1111-4111-8111-111111111111";
const gameId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-07-29T08:00:00Z");

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("guest quiz attempt", () => {
  it("deduplicates progress, resolves conflicts and submits an idempotent server score", async () => {
    const { client, database, quiz } = await setupQuiz();
    const guest = await createGuestSession(client, "web", now);
    const attempt = await startGuestQuizAttempt(client, gameId, guest.token, now);
    expect(attempt).toMatchObject({ answers: [], status: "in_progress", version: 1 });

    await expect(
      database.query(`insert into game_attempts (game_id, started_at) values ($1, $2)`, [
        gameId,
        now,
      ]),
    ).rejects.toThrow();
    await expect(
      database.query(
        `insert into game_attempts (game_id, guest_session_id, user_id, started_at)
         values ($1, $2, $3, $4)`,
        [gameId, guest.guestSessionId, "60000000-0000-4000-8000-000000000001", now],
      ),
    ).rejects.toThrow();

    const firstEvent = {
      clientEventId: "30000000-0000-4000-8000-000000000000",
      elapsedMs: 0,
      questionId: quiz.questions[0]!.id,
      selectedOptionId: quiz.questions[0]!.options[0]!.id,
    };
    expect(
      await saveGuestQuizProgress(client, attempt.attemptId, guest.token, 1, [firstEvent], now),
    ).toEqual({ savedEvents: 1, status: "saved", version: 2 });
    expect(
      await saveGuestQuizProgress(client, attempt.attemptId, guest.token, 2, [firstEvent], now),
    ).toEqual({ savedEvents: 0, status: "saved", version: 2 });

    const conflict = await saveGuestQuizProgress(
      client,
      attempt.attemptId,
      guest.token,
      1,
      [
        {
          clientEventId: "30000000-0000-4000-8000-000000000001",
          elapsedMs: 20_000,
          questionId: quiz.questions[1]!.id,
          selectedOptionId: quiz.questions[1]!.options[0]!.id,
        },
      ],
      now,
    );
    expect(conflict).toMatchObject({ status: "conflict", state: { version: 2 } });

    const remaining = quiz.questions.slice(1).map((question, index) => ({
      clientEventId: `30000000-0000-4000-8000-00000000000${index + 2}`,
      elapsedMs: 20_000,
      questionId: question.id,
      selectedOptionId: question.options[0]!.id,
    }));
    expect(
      await saveGuestQuizProgress(client, attempt.attemptId, guest.token, 2, remaining, now),
    ).toEqual({ savedEvents: 4, status: "saved", version: 3 });

    const submitted = await submitGuestQuizAttempt(client, attempt.attemptId, guest.token, now);
    expect(submitted).toMatchObject({
      attemptId: attempt.attemptId,
      competitive: true,
      provisional: { completed: true, score: 800 },
      status: "accepted",
    });
    expect(await submitGuestQuizAttempt(client, attempt.attemptId, guest.token, now)).toEqual(
      submitted,
    );
    expect(await startGuestQuizAttempt(client, gameId, guest.token, now)).toMatchObject({
      result: submitted,
      status: "accepted",
    });
    const outbox = await database.query<{ count: number }>(
      "select count(*)::int as count from outbox_events where event_type = 'GameAttemptAccepted'",
    );
    expect(outbox.rows[0]?.count).toBe(1);
  });

  it("marks a late submission casual", async () => {
    const { client } = await setupQuiz();
    const guest = await createGuestSession(client, "android", now);
    const attempt = await startGuestQuizAttempt(client, gameId, guest.token, now);

    const submitted = await submitGuestQuizAttempt(
      client,
      attempt.attemptId,
      guest.token,
      new Date("2026-07-29T22:00:00Z"),
    );

    expect(submitted.competitive).toBe(false);
  });

  it("limits an impossible client timer with the server window", async () => {
    const { client, quiz } = await setupQuiz();
    const guest = await createGuestSession(client, "web", now);
    const attempt = await startGuestQuizAttempt(client, gameId, guest.token, now);
    const events = quiz.questions.map((question, index) => ({
      clientEventId: `70000000-0000-4000-8000-00000000000${index}`,
      elapsedMs: 0,
      questionId: question.id,
      selectedOptionId: question.options[0]!.id,
    }));
    const submittedAt = new Date(now.getTime() + 102_000);

    await saveGuestQuizProgress(client, attempt.attemptId, guest.token, 1, events, submittedAt);
    const submitted = await submitGuestQuizAttempt(
      client,
      attempt.attemptId,
      guest.token,
      submittedAt,
    );

    expect(submitted.provisional.score).toBe(775);
  });

  it("resumes one user attempt across devices and rejects another owner", async () => {
    const { client, database, quiz } = await setupQuiz();
    const userId = "60000000-0000-4000-8000-000000000001";
    const otherUserId = "60000000-0000-4000-8000-000000000002";
    await database.query(
      `insert into users (id, auth_provider, external_subject, email_normalized)
       values ($1, 'supabase', 'user-1', 'uno@example.com'),
              ($2, 'supabase', 'user-2', 'dos@example.com')`,
      [userId, otherUserId],
    );

    const first = await startUserQuizAttempt(client, gameId, userId, now);
    const resumed = await startUserQuizAttempt(client, gameId, userId, now);
    expect(resumed.attemptId).toBe(first.attemptId);
    const answer = {
      clientEventId: "30000000-0000-4000-8000-000000000099",
      elapsedMs: 2_000,
      questionId: quiz.questions[0]!.id,
      selectedOptionId: quiz.questions[0]!.options[0]!.id,
    };
    expect(await saveUserQuizProgress(client, first.attemptId, userId, 1, [answer], now)).toEqual({
      savedEvents: 1,
      status: "saved",
      version: 2,
    });
    await expect(
      saveUserQuizProgress(client, first.attemptId, otherUserId, 2, [answer], now),
    ).rejects.toMatchObject({ code: "ATTEMPT_NOT_FOUND" });
    expect(await submitUserQuizAttempt(client, first.attemptId, userId, now)).toMatchObject({
      attemptId: first.attemptId,
      status: "accepted",
    });
  });
});

async function setupQuiz() {
  const database = new PGlite();
  databases.push(database);
  await migrate(drizzle(database), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  const client = new PGliteClient(database);
  const quiz = makeQuiz();
  const solution: QuizPrivateSolution = {
    kind: "quiz-solution",
    questions: quiz.questions.map((question) => ({
      correctOptionId: question.options[0]!.id,
      explanation: "Explicación verificada",
      questionId: question.id,
    })),
  };
  await database.query(
    `insert into daily_editions (id, local_date, status, opens_at, closes_at, published_at)
     values ($1, '2026-07-29', 'published', $2, $3, $2)`,
    [editionId, "2026-07-28T22:00:00Z", "2026-07-29T22:00:00Z"],
  );
  await database.query(
    `insert into games (id, edition_id, type, public_payload)
     values ($1, $2, 'quiz', $3::jsonb)`,
    [gameId, editionId, JSON.stringify(quiz)],
  );
  await database.query(
    `insert into game_solutions (game_id, private_payload)
     values ($1, $2::jsonb)`,
    [gameId, JSON.stringify(solution)],
  );
  return { client, database, quiz };
}

function makeQuiz(): QuizPublicPayload {
  return {
    kind: "quiz",
    title: "Quiz diario",
    questions: Array.from({ length: 5 }, (_, questionIndex) => ({
      id: `40000000-0000-4000-8000-00000000000${questionIndex}`,
      prompt: `Pregunta ${questionIndex + 1}`,
      category: "General",
      difficulty: questionIndex === 0 ? "easy" : questionIndex === 1 ? "medium" : "hard",
      options: Array.from({ length: 4 }, (_, optionIndex) => ({
        id: `50000000-0000-4000-8000-0000000000${questionIndex}${optionIndex}`,
        text: `Opción ${optionIndex + 1}`,
      })),
    })),
  };
}
