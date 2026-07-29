import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getAnalyticsDashboard } from "./analytics-dashboard.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.close())));

describe("privacy-safe analytics dashboard", () => {
  it("returns Madrid-day aggregates and deduplicates attempts", async () => {
    const database = new PGlite();
    databases.push(database);
    await migrate(drizzle(database), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    const client = new PGliteClient(database);
    const events = [
      event(
        1,
        "guest",
        "11111111-1111-4111-8111-111111111111",
        "AppOpened",
        {},
        "2026-07-27T22:30:00Z",
      ),
      event(
        2,
        "guest",
        "11111111-1111-4111-8111-111111111111",
        "AppOpened",
        {},
        "2026-07-29T08:00:00Z",
      ),
      event(
        3,
        "user",
        "22222222-2222-4222-8222-222222222222",
        "AppOpened",
        {},
        "2026-07-29T09:00:00Z",
      ),
      event(
        4,
        "guest",
        "11111111-1111-4111-8111-111111111111",
        "GameStarted",
        { attemptId: "attempt-a" },
        "2026-07-29T09:01:00Z",
      ),
      event(
        5,
        "guest",
        "11111111-1111-4111-8111-111111111111",
        "GameStarted",
        { attemptId: "attempt-a" },
        "2026-07-29T09:02:00Z",
      ),
      event(
        6,
        "user",
        "22222222-2222-4222-8222-222222222222",
        "GameStarted",
        { attemptId: "attempt-b" },
        "2026-07-29T09:03:00Z",
      ),
      event(
        7,
        "guest",
        "11111111-1111-4111-8111-111111111111",
        "GameCompleted",
        { attemptId: "attempt-a" },
        "2026-07-29T09:10:00Z",
      ),
      event(
        8,
        "guest",
        "11111111-1111-4111-8111-111111111111",
        "ShareCompleted",
        {},
        "2026-07-29T09:11:00Z",
      ),
      event(
        9,
        "user",
        "22222222-2222-4222-8222-222222222222",
        "RegistrationCompleted",
        {},
        "2026-07-29T09:12:00Z",
      ),
    ];
    for (const item of events) {
      await database.query(
        `insert into analytics_events
           (event_id, subject_type, subject_id, event_name, event_version, occurred_at,
            received_at, properties, consent_policy_version)
         values ($1, $2, $3, $4, 1, $5, $5, $6::jsonb, '2026-07-01')`,
        [
          item.id,
          item.subjectType,
          item.subjectId,
          item.name,
          item.at,
          JSON.stringify(item.properties),
        ],
      );
    }
    await database.query(
      `insert into analytics_event_quarantine
         (subject_type, event_count, reason, structural_fingerprint, received_at)
       values ('guest', 1, 'INVALID_ANALYTICS_EVENT', $1, '2026-07-29T09:15:00Z')`,
      ["a".repeat(64)],
    );

    const dashboard = await getAnalyticsDashboard(client, new Date("2026-07-29T12:00:00Z"));
    expect(dashboard.period).toEqual({ days: 7, from: "2026-07-23", to: "2026-07-29" });
    expect(dashboard.totals).toEqual({
      activeSubjects: 2,
      completionRate: 50,
      completions: 1,
      quarantinedBatches: 1,
      registrations: 1,
      shares: 1,
      starts: 2,
    });
    expect(dashboard.daily).toEqual([
      { activeSubjects: 1, completions: 0, localDate: "2026-07-28", starts: 0 },
      { activeSubjects: 2, completions: 1, localDate: "2026-07-29", starts: 2 },
    ]);
    expect(dashboard).not.toHaveProperty("subjectId");
    expect(JSON.stringify(dashboard)).not.toContain("attempt-a");
  });

  it("returns an empty, bounded period without inventing a rate", async () => {
    const database = new PGlite();
    databases.push(database);
    await migrate(drizzle(database), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    const dashboard = await getAnalyticsDashboard(
      new PGliteClient(database),
      new Date("2026-07-29T12:00:00Z"),
      100,
    );
    expect(dashboard.period.days).toBe(30);
    expect(dashboard.totals.completionRate).toBeNull();
    expect(dashboard.daily).toEqual([]);
    expect(dashboard.freshness).toBeNull();
  });
});

function event(
  number: number,
  subjectType: "guest" | "user",
  subjectId: string,
  name: string,
  properties: Record<string, string>,
  at: string,
) {
  return {
    at,
    id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    name,
    properties,
    subjectId,
    subjectType,
  };
}
