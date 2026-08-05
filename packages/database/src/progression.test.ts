import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createGuestSession } from "./guests.js";
import { getPlayerProgression } from "./progression.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];
const now = new Date("2026-08-05T12:00:00Z");

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.close())));

describe("experience ledger", () => {
  it("awards completion XP once and a daily-double bonus for a second game", async () => {
    const database = new PGlite();
    databases.push(database);
    await migrate(drizzle(database), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    const client = new PGliteClient(database);
    const guest = await createGuestSession(client, "web", now);
    const editionId = "11111111-1111-4111-8111-111111111111";
    await database.query(
      `insert into daily_editions (id, local_date, opens_at, closes_at)
       values ($1, '2026-08-05', $2, $3)`,
      [editionId, "2026-08-05T00:00:00Z", "2026-08-06T00:00:00Z"],
    );
    for (const [index, type] of ["quiz", "crossword"].entries()) {
      const gameId = `22222222-2222-4222-8222-22222222222${index + 1}`;
      const attemptId = `33333333-3333-4333-8333-33333333333${index + 1}`;
      await database.query(
        `insert into games (id, edition_id, type, public_payload)
         values ($1, $2, $3, '{}'::jsonb)`,
        [gameId, editionId, type],
      );
      await database.query(
        `insert into game_attempts (id, game_id, guest_session_id, status, started_at)
         values ($1, $2, $3, 'accepted', $4)`,
        [attemptId, gameId, guest.guestSessionId, now],
      );
      await database.query(
        `insert into scores (attempt_id, points, score_version, competitive, duration_ms, breakdown)
         values ($1, 100, 'test', true, 1000, '{"completed":true}'::jsonb)`,
        [attemptId],
      );
    }

    expect(await getPlayerProgression(client, { kind: "guest", token: guest.token }, now)).toEqual({
      achievements: [
        { earnedAt: expect.any(String), key: "first-game" },
        { earnedAt: expect.any(String), key: "daily-double" },
      ],
      experience: 400,
      level: 3,
      nextLevelExperience: 600,
      version: "xp-v1",
    });
  });
});
