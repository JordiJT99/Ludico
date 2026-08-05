import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { disableGame, scheduleReserveEdition } from "./admin.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("emergency administration", () => {
  it("schedules a complete reserve and disables a game idempotently", async () => {
    const database = new PGlite();
    databases.push(database);
    await migrate(drizzle(database), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    const client = new PGliteClient(database);
    const editionId = "11111111-1111-4111-8111-111111111111";
    const quizId = "22222222-2222-4222-8222-222222222222";
    const crosswordId = "33333333-3333-4333-8333-333333333333";

    await database.query(
      `insert into daily_editions (id, local_date, status, opens_at, closes_at)
       values ($1, '2026-07-28', 'approved', $2, $3)`,
      [editionId, "2026-07-27T22:00:00Z", "2026-07-28T22:00:00Z"],
    );
    const gameTypes = [
      [quizId, "quiz"],
      [crosswordId, "crossword"],
      ["44444444-4444-4444-8444-444444444444", "true_false"],
      ["55555555-5555-4555-8555-555555555555", "guess_word"],
      ["66666666-6666-4666-8666-666666666666", "word_search"],
    ] as const;
    for (const [id, type] of gameTypes.slice(0, 2)) {
      await database.query(
        "insert into games (id, edition_id, type, public_payload) values ($1, $2, $3, '{}'::jsonb)",
        [id, editionId, type],
      );
      await database.query(
        "insert into game_solutions (game_id, private_payload) values ($1, '{}'::jsonb)",
        [id],
      );
    }

    await expect(
      scheduleReserveEdition(client, editionId, "reserva incompleta", "test-0"),
    ).rejects.toMatchObject({
      code: "EDITION_NOT_READY",
    });
    for (const [id, type] of gameTypes.slice(2)) {
      await database.query(
        "insert into games (id, edition_id, type, public_payload) values ($1, $2, $3, '{}'::jsonb)",
        [id, editionId, type],
      );
      await database.query(
        "insert into game_solutions (game_id, private_payload) values ($1, '{}'::jsonb)",
        [id],
      );
    }

    expect(
      await scheduleReserveEdition(client, editionId, "reserva validada", "test-1", {
        id: "editor-1",
        type: "admin",
      }),
    ).toEqual({ changed: true, status: "scheduled" });
    expect(await scheduleReserveEdition(client, editionId, "reintento seguro", "test-2")).toEqual({
      changed: false,
      status: "scheduled",
    });
    expect(await disableGame(client, quizId, "contenido defectuoso", "test-3")).toEqual({
      changed: true,
      status: "disabled",
    });
    expect(await disableGame(client, quizId, "reintento seguro", "test-4")).toEqual({
      changed: false,
      status: "disabled",
    });

    const audit = await database.query<{ count: number }>(
      "select count(*)::int as count from audit_logs",
    );
    expect(audit.rows[0]?.count).toBe(2);
    expect(
      (
        await database.query<{ actor_id: string; actor_type: string }>(
          "select actor_id, actor_type from audit_logs where action = 'schedule'",
        )
      ).rows[0],
    ).toEqual({ actor_id: "editor-1", actor_type: "admin" });
  });
});
