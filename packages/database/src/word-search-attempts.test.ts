import type { WordSearchPublicPayload } from "@ludico/contracts";
import { constructWordSearch } from "@ludico/domain";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createGuestSession } from "./guests.js";
import {
  recordGuestWordSearchSelection,
  startGuestWordSearchAttempt,
} from "./word-search-attempts.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];
const editionId = "71111111-1111-4111-8111-111111111111";
const gameId = "72222222-2222-4222-8222-222222222222";
const now = new Date("2026-08-04T08:00:00.000Z");

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("word search attempt", () => {
  it("keeps coordinates private, accepts valid selections and finishes once", async () => {
    const { client, database, entries, words } = await setupGame();
    const guest = await createGuestSession(client, "web", now);
    const attempt = await startGuestWordSearchAttempt(client, gameId, guest.token, now);
    expect(attempt).toMatchObject({ foundEntries: [], status: "in_progress", version: 1 });
    expect(JSON.stringify(attempt)).not.toContain("direction");

    const bad = await recordGuestWordSearchSelection(
      client,
      attempt.attemptId,
      guest.token,
      {
        ...selection(words[0]!.id, entries[0]!, 1, 1),
        endColumn: 0,
        endRow: 0,
        startColumn: 0,
        startRow: 0,
      },
      now,
    );
    expect(bad).toMatchObject({ outcome: "incorrect", attempt: { version: 1 } });

    let version = 1;
    for (const [index, entry] of entries.entries()) {
      const found = await recordGuestWordSearchSelection(
        client,
        attempt.attemptId,
        guest.token,
        selection(words[index]!.id, entry, version, index + 2),
        now,
      );
      expect(found.outcome).toBe("found");
      version += 1;
      if (index < entries.length - 1)
        expect(found.attempt).toMatchObject({ status: "in_progress", version });
      else {
        expect(found.attempt).toMatchObject({
          result: { provisional: { score: 1000 } },
          status: "accepted",
          version: version + 1,
        });
      }
    }
    const stored = await database.query<{ entry_id: string }>(
      "select entry_id from word_search_finds where attempt_id = $1 order by created_at",
      [attempt.attemptId],
    );
    expect(stored.rows).toHaveLength(3);
  });
});

function selection(
  entryId: string,
  entry: { answer: string; column: number; direction: string; row: number },
  version: number,
  suffix: number,
) {
  const vectors: Record<string, readonly [number, number]> = {
    east: [0, 1],
    north: [-1, 0],
    northEast: [-1, 1],
    northWest: [-1, -1],
    south: [1, 0],
    southEast: [1, 1],
    southWest: [1, -1],
    west: [0, -1],
  };
  const [row, column] = vectors[entry.direction]!;
  return {
    clientEventId: `73333333-3333-4333-8333-33333333333${suffix}`,
    elapsedMs: suffix * 1_000,
    endColumn: entry.column + column * (entry.answer.length - 1),
    endRow: entry.row + row * (entry.answer.length - 1),
    entryId,
    startColumn: entry.column,
    startRow: entry.row,
    version,
  };
}

async function setupGame() {
  const database = new PGlite();
  databases.push(database);
  await migrate(drizzle(database), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  const client = new PGliteClient(database);
  const game = constructWordSearch({
    columns: 8,
    directions: ["east", "south", "southEast"],
    rows: 8,
    seed: "word-search-attempt",
    words: ["LUNA", "NUBE", "SOL"],
  });
  const words = game.entries.map((entry, index) => ({
    answer: entry.answer,
    id: `74444444-4444-4444-8444-44444444444${index + 1}`,
  }));
  const publicPayload: WordSearchPublicPayload = {
    columns: game.columns,
    grid: game.grid,
    kind: "word-search",
    rows: game.rows,
    seed: game.seed,
    title: "Sopa de letras",
    words,
  };
  await database.query(
    `insert into daily_editions (id, local_date, status, opens_at, closes_at, published_at)
     values ($1, '2026-08-04', 'published', $2, $3, $2)`,
    [editionId, "2026-08-03T22:00:00Z", "2026-08-04T22:00:00Z"],
  );
  await database.query(
    `insert into games (id, edition_id, type, public_payload)
     values ($1, $2, 'word_search', $3::jsonb)`,
    [gameId, editionId, JSON.stringify(publicPayload)],
  );
  await database.query(
    `insert into game_solutions (game_id, private_payload) values ($1, $2::jsonb)`,
    [gameId, JSON.stringify({ entries: game.entries, kind: "word-search-solution" })],
  );
  return { client, database, entries: game.entries, words };
}
