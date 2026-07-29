import { PGlite } from "@electric-sql/pglite";
import { constructCrossword } from "@ludico/domain";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PGliteClient } from "./test-support/pglite-client.js";
import {
  deactivateWordBankEntry,
  listCuratedWordBank,
  upsertWordBankEntry,
  WordBankError,
} from "./word-bank.js";

const databases: PGlite[] = [];
const now = new Date("2026-07-29T12:00:00Z");

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.close())));

describe("curated crossword word bank", () => {
  it("validates provenance, audits curation and feeds the deterministic constructor", async () => {
    const database = new PGlite();
    databases.push(database);
    await migrate(drizzle(database), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    const client = new PGliteClient(database);
    const curated = [];
    for (const [answer, clue] of [
      ["SOL", "Astro que ilumina el día"],
      ["SAL", "Condimento mineral"],
      ["LUZ", "Lo contrario de oscuridad"],
    ] as const) {
      curated.push(
        await upsertWordBankEntry(
          client,
          {
            answer,
            category: "General",
            clue,
            difficulty: 2,
            qualityScore: 90,
            sourceCheckedAt: now,
            sourceUrl: `https://rae.example/${answer.toLowerCase()}`,
            validationStatus: "approved",
            variants: [],
          },
          "editor-1",
          "Fuente y pista revisadas manualmente",
          `curate-${answer}`,
          now,
        ),
      );
    }
    const bank = await listCuratedWordBank(client, now);
    expect(bank).toHaveLength(3);
    expect(() =>
      constructCrossword(bank, {
        seed: "database-bank",
        title: "Banco curado",
        vocabularyVersion: "db-es-v1",
      }),
    ).not.toThrow();
    expect(
      (await database.query("select * from audit_logs where target_type = 'WordBankEntry'")).rows,
    ).toHaveLength(3);

    expect(
      await deactivateWordBankEntry(
        client,
        curated[0]!.id,
        "editor-1",
        "La fuente ha dejado de estar vigente",
        "deactivate-sol",
        now,
      ),
    ).toMatchObject({ active: false, changed: true });
    expect(await listCuratedWordBank(client, now)).toHaveLength(2);
  });

  it("rejects unverified or malformed entries", async () => {
    const database = new PGlite();
    databases.push(database);
    await migrate(drizzle(database), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    const client = new PGliteClient(database);
    await expect(
      upsertWordBankEntry(
        client,
        {
          answer: "A B",
          category: "General",
          clue: "Inválida",
          qualityScore: 101,
          sourceCheckedAt: now,
          sourceUrl: "http://example.com",
          difficulty: 2,
          validationStatus: "approved",
          variants: [],
        },
        "editor-1",
        "Intento inválido documentado",
        "invalid-entry",
        now,
      ),
    ).rejects.toEqual(new WordBankError("INVALID_ENTRY"));
  });
});
