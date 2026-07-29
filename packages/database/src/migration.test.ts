import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "./schema.js";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("initial migration", () => {
  it("creates constrained edition and solution storage", async () => {
    const client = new PGlite();
    databases.push(client);
    const db = drizzle(client, { schema });
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });

    await db.insert(schema.dailyEditions).values({
      localDate: "2026-07-28",
      opensAt: new Date("2026-07-27T22:00:00Z"),
      closesAt: new Date("2026-07-28T22:00:00Z"),
    });

    await expect(
      db.insert(schema.dailyEditions).values({
        localDate: "2026-07-28",
        opensAt: new Date("2026-07-27T22:00:00Z"),
        closesAt: new Date("2026-07-28T22:00:00Z"),
      }),
    ).rejects.toThrow();

    const tables = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    expect(tables.rows.map((row) => row.table_name)).toContain("game_solutions");
    expect(tables.rows.map((row) => row.table_name)).toContain("crossword_cells");
    expect(tables.rows.map((row) => row.table_name)).toContain("users");
    const columns = await client.query<{ column_name: string; table_name: string }>(
      `select table_name, column_name from information_schema.columns
       where (table_name = 'users' and column_name in ('public_alias', 'leaderboard_opt_in'))
          or (table_name = 'scores' and column_name = 'duration_ms')`,
    );
    expect(columns.rows).toHaveLength(3);
  });
});
