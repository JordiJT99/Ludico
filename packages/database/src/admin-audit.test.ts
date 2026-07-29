import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { listAdminAudit } from "./admin-audit.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.close())));

describe("admin audit feed", () => {
  it("returns a bounded newest-first projection without metadata", async () => {
    const database = new PGlite();
    databases.push(database);
    await migrate(drizzle(database), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    await database.query(
      `insert into audit_logs
         (id, actor_type, actor_id, action, target_type, target_id, reason, correlation_id,
          metadata, occurred_at)
       values
         ('11111111-1111-4111-8111-111111111111', 'admin', 'editor-1', 'approve',
          'GeneratedContent', 'content-1', 'Fuentes verificadas', 'audit-1',
          '{"private":"not projected"}'::jsonb, '2026-07-29T10:00:00Z'),
         ('22222222-2222-4222-8222-222222222222', 'admin', 'editor-2', 'schedule',
          'DailyEdition', 'edition-1', 'Reserva completa', 'audit-2', '{}',
          '2026-07-29T11:00:00Z')`,
    );

    const records = await listAdminAudit(new PGliteClient(database), 1);
    expect(records).toEqual([
      {
        action: "schedule",
        actorId: "editor-2",
        actorType: "admin",
        correlationId: "audit-2",
        id: "22222222-2222-4222-8222-222222222222",
        occurredAt: "2026-07-29T11:00:00.000Z",
        reason: "Reserva completa",
        targetId: "edition-1",
        targetType: "DailyEdition",
      },
    ]);
    expect(JSON.stringify(records)).not.toContain("not projected");
  });
});
