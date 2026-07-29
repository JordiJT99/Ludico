import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  authenticateGuestSession,
  createGuestSession,
  hashGuestToken,
  revokeGuestSession,
  rotateGuestSession,
} from "./guests.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("guest sessions", () => {
  it("hashes, authenticates, rotates, expires and revokes independent devices", async () => {
    const database = new PGlite();
    databases.push(database);
    await migrate(drizzle(database), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    const client = new PGliteClient(database);
    const now = new Date("2026-07-29T08:00:00Z");

    const web = await createGuestSession(client, "web", now);
    const android = await createGuestSession(client, "android", now);

    expect(web.token).toHaveLength(43);
    expect(web.token).not.toBe(android.token);
    expect(web.guestSessionId).not.toBe(android.guestSessionId);
    const stored = await database.query<{ token_hash: string }>(
      "select token_hash from guest_sessions where id = $1",
      [web.guestSessionId],
    );
    expect(stored.rows[0]?.token_hash).toBe(hashGuestToken(web.token));
    expect(stored.rows[0]?.token_hash).not.toContain(web.token);

    expect(await authenticateGuestSession(client, web.token, now)).toMatchObject({
      guestSessionId: web.guestSessionId,
      origin: "web",
    });

    const rotated = await rotateGuestSession(client, web.token, new Date("2026-07-29T08:01:00Z"));
    expect(await authenticateGuestSession(client, web.token, now)).toBeNull();
    expect(await authenticateGuestSession(client, rotated.token, now)).toMatchObject({
      guestSessionId: web.guestSessionId,
    });
    const lineage = await database.query<{ previous_session_id: string; status: string }>(
      "select previous_session_id, status from guest_sessions where id = $1",
      [rotated.guestSessionId],
    );
    expect(lineage.rows[0]).toMatchObject({
      previous_session_id: web.guestSessionId,
      status: "active",
    });

    expect(
      await authenticateGuestSession(client, rotated.token, new Date("2026-08-29T08:02:00Z")),
    ).toBeNull();
    expect(await revokeGuestSession(client, android.token, now)).toBe(true);
    expect(await revokeGuestSession(client, android.token, now)).toBe(false);
    expect(await authenticateGuestSession(client, android.token, now)).toBeNull();
  });
});
