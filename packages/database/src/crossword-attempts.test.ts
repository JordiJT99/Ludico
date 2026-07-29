import type { CrosswordPublicPayload } from "@ludico/contracts";
import type { CrosswordPrivateSolution } from "@ludico/domain";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CrosswordAttemptError,
  revealGuestCrosswordCell,
  revealUserCrosswordCell,
  saveGuestCrosswordProgress,
  saveUserCrosswordProgress,
  startGuestCrosswordAttempt,
  startUserCrosswordAttempt,
  submitGuestCrosswordAttempt,
  submitUserCrosswordAttempt,
} from "./crossword-attempts.js";
import { createGuestSession } from "./guests.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];
const editionId = "11111111-1111-4111-8111-111111111111";
const gameId = "22222222-2222-4222-8222-222222222223";
const now = new Date("2026-07-29T08:00:00Z");

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("guest crossword attempt", () => {
  it("deduplicates cell events, persists erasure and submits a private server score", async () => {
    const { client, crossword, database } = await setupCrossword();
    const guest = await createGuestSession(client, "web", now);
    const attempt = await startGuestCrosswordAttempt(client, gameId, guest.token, now);
    expect(attempt).toMatchObject({ cells: [], hintsUsed: 0, status: "in_progress", version: 1 });

    const firstEvent = event(0, "S", 0);
    expect(
      await saveGuestCrosswordProgress(
        client,
        attempt.attemptId,
        guest.token,
        1,
        [firstEvent],
        now,
      ),
    ).toEqual({ savedEvents: 1, status: "saved", version: 2 });
    expect(
      await saveGuestCrosswordProgress(
        client,
        attempt.attemptId,
        guest.token,
        2,
        [firstEvent],
        now,
      ),
    ).toEqual({ savedEvents: 0, status: "saved", version: 2 });

    expect(
      await saveGuestCrosswordProgress(
        client,
        attempt.attemptId,
        guest.token,
        2,
        [event(1, "", 0)],
        now,
      ),
    ).toEqual({ savedEvents: 1, status: "saved", version: 3 });
    const conflict = await saveGuestCrosswordProgress(
      client,
      attempt.attemptId,
      guest.token,
      1,
      [event(2, "O", 1)],
      now,
    );
    expect(conflict).toMatchObject({ status: "conflict", state: { cells: [], version: 3 } });

    const values = ["S", "O", "L", "Á", "L", "U", "Z"];
    expect(
      await saveGuestCrosswordProgress(
        client,
        attempt.attemptId,
        guest.token,
        3,
        values.map((value, index) => event(index + 10, value, index, crossword)),
        now,
      ),
    ).toEqual({ savedEvents: 7, status: "saved", version: 4 });

    const submitted = await submitGuestCrosswordAttempt(
      client,
      attempt.attemptId,
      guest.token,
      now,
    );
    expect(submitted).toMatchObject({
      competitive: true,
      provisional: { completed: true, score: 1_350 },
      status: "accepted",
    });
    expect(await submitGuestCrosswordAttempt(client, attempt.attemptId, guest.token, now)).toEqual(
      submitted,
    );
    expect(await startGuestCrosswordAttempt(client, gameId, guest.token, now)).toMatchObject({
      result: submitted,
      status: "accepted",
    });
    const outbox = await database.query<{ count: number }>(
      "select count(*)::int as count from outbox_events where event_type = 'GameAttemptAccepted'",
    );
    expect(outbox.rows[0]?.count).toBe(1);
  });

  it("rejects a value that is not one Spanish letter", async () => {
    const { client } = await setupCrossword();
    const guest = await createGuestSession(client, "android", now);
    const attempt = await startGuestCrosswordAttempt(client, gameId, guest.token, now);

    await expect(
      saveGuestCrosswordProgress(
        client,
        attempt.attemptId,
        guest.token,
        1,
        [event(0, "AB", 0)],
        now,
      ),
    ).rejects.toBeInstanceOf(CrosswordAttemptError);
  });

  it("reveals a letter once and makes the score non-competitive", async () => {
    const { client, crossword } = await setupCrossword();
    const guest = await createGuestSession(client, "ios", now);
    const attempt = await startGuestCrosswordAttempt(client, gameId, guest.token, now);
    const hintEventId = "b0000000-0000-4000-8000-999999999999";

    const hint = await revealGuestCrosswordCell(
      client,
      attempt.attemptId,
      guest.token,
      crossword.cells[0]!.id,
      hintEventId,
      now,
    );
    expect(hint).toMatchObject({ competitive: false, hintsUsed: 1, value: "S", version: 2 });
    expect(
      await revealGuestCrosswordCell(
        client,
        attempt.attemptId,
        guest.token,
        crossword.cells[0]!.id,
        hintEventId,
        now,
      ),
    ).toEqual(hint);

    const remaining = ["O", "L", "Á", "L", "U", "Z"].map((value, index) =>
      event(index + 30, value, index + 1, crossword),
    );
    await saveGuestCrosswordProgress(client, attempt.attemptId, guest.token, 2, remaining, now);
    const submitted = await submitGuestCrosswordAttempt(
      client,
      attempt.attemptId,
      guest.token,
      now,
    );
    expect(submitted).toMatchObject({
      competitive: false,
      provisional: { completed: true, score: 1_250 },
    });
  });

  it("resumes crossword progress for the same user on another device", async () => {
    const { client, crossword, database } = await setupCrossword();
    const userId = "60000000-0000-4000-8000-000000000003";
    await database.query(
      `insert into users (id, auth_provider, external_subject, email_normalized)
       values ($1, 'supabase', 'crossword-user', 'crucigrama@example.com')`,
      [userId],
    );

    const first = await startUserCrosswordAttempt(client, gameId, userId, now);
    await saveUserCrosswordProgress(
      client,
      first.attemptId,
      userId,
      1,
      [event(80, "S", 0, crossword)],
      now,
    );
    const resumed = await startUserCrosswordAttempt(client, gameId, userId, now);
    expect(resumed).toMatchObject({
      attemptId: first.attemptId,
      cells: [{ cellId: crossword.cells[0]!.id, value: "S" }],
      version: 2,
    });
    const hint = await revealUserCrosswordCell(
      client,
      first.attemptId,
      userId,
      crossword.cells[1]!.id,
      "b0000000-0000-4000-8000-000000000081",
      now,
    );
    expect(hint).toMatchObject({ hintsUsed: 1, value: "O", version: 3 });
    expect(await submitUserCrosswordAttempt(client, first.attemptId, userId, now)).toMatchObject({
      competitive: false,
      status: "accepted",
    });
  });
});

async function setupCrossword() {
  const database = new PGlite();
  databases.push(database);
  await migrate(drizzle(database), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  const client = new PGliteClient(database);
  const crossword = makeCrossword();
  const solution: CrosswordPrivateSolution = {
    entries: [
      { answer: "SOL", entryId: crossword.entries[0]!.id },
      { answer: "SAL", entryId: crossword.entries[1]!.id },
      { answer: "LUZ", entryId: crossword.entries[2]!.id },
    ],
    kind: "crossword-solution",
    uniqueness: { alternativeCount: 1, vocabularyVersion: "test-v1" },
  };
  await database.query(
    `insert into daily_editions (id, local_date, status, opens_at, closes_at, published_at)
     values ($1, '2026-07-29', 'published', $2, $3, $2)`,
    [editionId, "2026-07-28T22:00:00Z", "2026-07-29T22:00:00Z"],
  );
  await database.query(
    `insert into games (id, edition_id, type, public_payload)
     values ($1, $2, 'crossword', $3::jsonb)`,
    [gameId, editionId, JSON.stringify(crossword)],
  );
  await database.query(
    `insert into game_solutions (game_id, private_payload)
     values ($1, $2::jsonb)`,
    [gameId, JSON.stringify(solution)],
  );
  return { client, crossword, database };
}

function makeCrossword(): CrosswordPublicPayload {
  const cells = [
    cell(0, 0, 0, 1),
    cell(1, 0, 1),
    cell(2, 0, 2),
    cell(3, 1, 0),
    cell(4, 2, 0, 2),
    cell(5, 2, 1),
    cell(6, 2, 2),
  ];
  return {
    blocks: [
      { column: 1, row: 1 },
      { column: 2, row: 1 },
    ],
    cells,
    columns: 3,
    entries: [
      {
        cellIds: cells.slice(0, 3).map(({ id }) => id),
        clue: "Astro que ilumina el día",
        direction: "across",
        id: "e0000000-0000-4000-8000-000000000001",
        number: 1,
      },
      {
        cellIds: [cells[0]!.id, cells[3]!.id, cells[4]!.id],
        clue: "Condimento mineral",
        direction: "down",
        id: "e0000000-0000-4000-8000-000000000002",
        number: 1,
      },
      {
        cellIds: cells.slice(4).map(({ id }) => id),
        clue: "Lo contrario de oscuridad",
        direction: "across",
        id: "e0000000-0000-4000-8000-000000000003",
        number: 2,
      },
    ],
    kind: "crossword",
    rows: 3,
    rules: { accentPolicy: "fold" },
    title: "Crucigrama diario",
  };
}

function cell(index: number, row: number, column: number, number?: number) {
  return {
    column,
    id: `a0000000-0000-4000-8000-00000000000${index}`,
    ...(number ? { number } : {}),
    row,
  };
}

function event(eventIndex: number, value: string, cellIndex: number, crossword = makeCrossword()) {
  return {
    cellId: crossword.cells[cellIndex]!.id,
    clientEventId: `b0000000-0000-4000-8000-${String(eventIndex).padStart(12, "0")}`,
    elapsedMs: 100,
    value,
  };
}
