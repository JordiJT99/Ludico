import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getContentGenerationHealth } from "./content-health.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.close())));

describe("content generation health", () => {
  it("summarises reserve, jobs, cost and tomorrow without content payloads", async () => {
    const database = await createDatabase();
    const now = new Date("2026-08-05T10:00:00Z");
    await database.query(
      `insert into content_generation_jobs
         (id, content_type, target_date, status, provider, budget_micros, cost_micros, finished_at)
       values
         ('00000000-0000-4000-8000-000000000001', 'quiz', '2026-08-06', 'succeeded', 'deterministic', 10, 7, $1),
         ('00000000-0000-4000-8000-000000000002', 'crossword', '2026-08-06', 'failed', 'deterministic', 10, 0, $1),
         ('00000000-0000-4000-8000-000000000003', 'true_false', '2026-08-06', 'queued', 'deterministic', 10, 0, null)`,
      [now],
    );
    await database.query(
      `insert into generated_contents
         (generation_job_id, content_type, target_date, status, public_payload, private_payload,
          sources, content_hash)
       values
         ('00000000-0000-4000-8000-000000000001', 'quiz', '2026-08-06', 'approved', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'a'),
         ('00000000-0000-4000-8000-000000000002', 'crossword', '2026-08-06', 'approved', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'b')`,
    );
    await database.query(
      `insert into daily_editions (id, market, local_date, status, opens_at, closes_at)
       values ('00000000-0000-4000-8000-000000000004', 'ES', '2026-08-06', 'scheduled', $1, $2)`,
      [new Date("2026-08-05T22:00:00Z"), new Date("2026-08-06T22:00:00Z")],
    );

    const health = await getContentGenerationHealth(new PGliteClient(database), now);

    expect(health).toMatchObject({
      alerts: [
        { code: "CONTENT_RESERVE_LOW", severity: "emergency" },
        { code: "CONTENT_JOB_FAILURES", severity: "warning" },
      ],
      healthy: false,
      jobs: {
        failedLast24Hours: 1,
        queued: 1,
        running: 0,
        succeededLast24Hours: 1,
      },
      nextEdition: { localDate: "2026-08-06", ready: true },
      reserve: { crossword: 1, guess_word: 0, quiz: 1, true_false: 0, word_search: 0 },
      spendMicrosToday: 7,
    });
    expect(JSON.stringify(health)).not.toContain("publicPayload");
  });

  it("alerts when tomorrow has not been assembled", async () => {
    const database = await createDatabase();
    const health = await getContentGenerationHealth(
      new PGliteClient(database),
      new Date("2026-08-05T10:00:00Z"),
    );
    expect(health.alerts).toContainEqual({ code: "NEXT_EDITION_MISSING", severity: "critical" });
  });
});

async function createDatabase(): Promise<PGlite> {
  const database = new PGlite();
  databases.push(database);
  await migrate(drizzle(database), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  return database;
}
