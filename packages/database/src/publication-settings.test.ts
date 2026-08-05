import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultPublicationSettings,
  getPublicationSettings,
  updatePublicationSettings,
} from "./publication-settings.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.close())));

describe("publication settings", () => {
  it("uses safe defaults and audits a validated editor change", async () => {
    const { client, database } = await setup();
    expect(await getPublicationSettings(client)).toEqual(defaultPublicationSettings);

    await expect(
      updatePublicationSettings(
        client,
        {
          closesAtLocalTime: "00:00",
          contentPlanLocalTime: "25:00",
          opensAtLocalTime: "00:00",
          reserveDays: 14,
        },
        "editor-1",
        "Ajuste validado del horario editorial",
        "settings-1",
        new Date("2026-08-01T10:00:00Z"),
      ),
    ).rejects.toThrow("PUBLICATION_SETTINGS_INVALID");

    const settings = await updatePublicationSettings(
      client,
      {
        closesAtLocalTime: "06:00",
        contentPlanLocalTime: "01:15",
        opensAtLocalTime: "06:00",
        reserveDays: 16,
      },
      "editor-1",
      "Ajuste validado del horario editorial",
      "settings-2",
      new Date("2026-08-01T10:00:00Z"),
    );
    expect(settings).toMatchObject({ contentPlanLocalTime: "01:15", reserveDays: 16 });
    expect(await getPublicationSettings(client)).toEqual(settings);
    expect(
      (
        await database.query(
          "select * from audit_logs where action = 'update_publication_settings'",
        )
      ).rows,
    ).toHaveLength(1);
  });
});

async function setup() {
  const database = new PGlite();
  databases.push(database);
  await migrate(drizzle(database), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  return { client: new PGliteClient(database), database };
}
