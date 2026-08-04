import type { GuessWordPublicPayload } from "@ludico/contracts";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createGuestSession } from "./guests.js";
import { recordGuestGuessWordGuess, startGuestGuessWordAttempt } from "./guess-word-attempts.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];
const editionId = "31111111-1111-4111-8111-111111111111";
const gameId = "32222222-2222-4222-8222-222222222222";
const now = new Date("2026-08-04T08:00:00.000Z");

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("guess word attempt", () => {
  it("keeps the answer private, scores a correct guess and retries idempotently", async () => {
    const { client, database } = await setupGame();
    const guest = await createGuestSession(client, "web", now);
    const attempt = await startGuestGuessWordAttempt(client, gameId, guest.token, now);
    expect(attempt).toMatchObject({ guesses: [], status: "in_progress", version: 1 });

    const wrong = await recordGuestGuessWordGuess(
      client,
      attempt.attemptId,
      guest.token,
      {
        clientEventId: "33333333-3333-4333-8333-333333333333",
        elapsedMs: 2_000,
        guess: "casa",
        version: 1,
      },
      now,
    );
    expect(wrong).toMatchObject({ outcome: "incorrect", attempt: { version: 2 } });
    expect(JSON.stringify(wrong)).not.toContain("ARBOL");

    const correctEvent = {
      clientEventId: "34444444-4444-4444-8444-444444444444",
      elapsedMs: 3_000,
      guess: "árbol",
      version: 2,
    };
    const correct = await recordGuestGuessWordGuess(
      client,
      attempt.attemptId,
      guest.token,
      correctEvent,
      now,
    );
    expect(correct).toMatchObject({
      outcome: "correct",
      attempt: { result: { provisional: { score: 850 } }, status: "accepted" },
    });
    expect(
      await recordGuestGuessWordGuess(client, attempt.attemptId, guest.token, correctEvent, now),
    ).toEqual(correct);
    const stored = await database.query<{ guess: string }>(
      "select guess from word_guesses where attempt_id = $1 order by created_at",
      [attempt.attemptId],
    );
    expect(stored.rows.map((row) => row.guess)).toEqual(["CASA", "ARBOL"]);
  });

  it("ends an unsolved challenge after its configured number of attempts", async () => {
    const { client } = await setupGame(2);
    const guest = await createGuestSession(client, "web", now);
    const attempt = await startGuestGuessWordAttempt(client, gameId, guest.token, now);
    await recordGuestGuessWordGuess(
      client,
      attempt.attemptId,
      guest.token,
      {
        clientEventId: "35555555-5555-4555-8555-555555555555",
        elapsedMs: 1_000,
        guess: "casa",
        version: 1,
      },
      now,
    );
    const exhausted = await recordGuestGuessWordGuess(
      client,
      attempt.attemptId,
      guest.token,
      {
        clientEventId: "36666666-6666-4666-8666-666666666666",
        elapsedMs: 1_000,
        guess: "perro",
        version: 2,
      },
      now,
    );
    expect(exhausted).toMatchObject({
      outcome: "exhausted",
      attempt: { result: { provisional: { score: 0 } }, status: "accepted" },
    });
  });
});

async function setupGame(maxAttempts = 5) {
  const database = new PGlite();
  databases.push(database);
  await migrate(drizzle(database), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  const client = new PGliteClient(database);
  const game: GuessWordPublicPayload = {
    allowedCharacters: Array.from("ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"),
    category: "Naturaleza",
    definition: "Planta alta de tronco leñoso y copa de ramas.",
    difficulty: 1,
    hints: [{ text: "Puede dar sombra.", unlockAfterAttempts: 1 }],
    id: "37777777-7777-4777-8777-777777777777",
    kind: "guess-word",
    maxAttempts,
    title: "Adivina la palabra",
  };
  const solution = { alternativeAnswers: [], answer: "ARBOL", kind: "guess-word-solution" };
  await database.query(
    `insert into daily_editions (id, local_date, status, opens_at, closes_at, published_at)
     values ($1, '2026-08-04', 'published', $2, $3, $2)`,
    [editionId, "2026-08-03T22:00:00Z", "2026-08-04T22:00:00Z"],
  );
  await database.query(
    `insert into games (id, edition_id, type, public_payload)
     values ($1, $2, 'guess_word', $3::jsonb)`,
    [gameId, editionId, JSON.stringify(game)],
  );
  await database.query(
    `insert into game_solutions (game_id, private_payload) values ($1, $2::jsonb)`,
    [gameId, JSON.stringify(solution)],
  );
  return { client, database };
}
