import { PGlite } from "@electric-sql/pglite";
import { fromPglite, PgBoss } from "pg-boss";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTENT_ASSEMBLY_QUEUE,
  CONTENT_GENERATION_QUEUE,
  CONTENT_HEALTH_QUEUE,
  CONTENT_PLAN_QUEUE,
  configureQueues,
  configureSchedules,
  DEAD_LETTER_QUEUE,
  NOTIFICATION_DELIVERY_QUEUE,
  NOTIFICATION_SCHEDULE_QUEUE,
  PRIVACY_RETENTION_QUEUE,
  PUBLICATION_QUEUE,
} from "./jobs.js";

const resources: Array<{ boss: PgBoss; database: PGlite }> = [];

afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async ({ boss, database }) => {
      await boss.stop({ graceful: false });
      await database.close();
    }),
  );
});

describe("worker queues", () => {
  it("configures retry, dead-letter and singleton delivery", async () => {
    const database = new PGlite();
    const boss = new PgBoss({ backend: "pglite", db: fromPglite(database) });
    resources.push({ boss, database });
    await boss.start();
    await configureQueues(boss);
    await configureSchedules(boss, { notifications: true });

    const queue = await boss.getQueue(PUBLICATION_QUEUE);
    expect(queue).toMatchObject({
      deadLetter: DEAD_LETTER_QUEUE,
      policy: "exclusive",
      retryBackoff: true,
      retryLimit: 5,
    });
    expect(await boss.getSchedules(PUBLICATION_QUEUE, "ES")).toHaveLength(1);
    expect(await boss.getQueue(CONTENT_GENERATION_QUEUE)).toMatchObject({
      deadLetter: DEAD_LETTER_QUEUE,
      retryLimit: 5,
    });
    expect(await boss.getSchedules(CONTENT_PLAN_QUEUE, "ES")).toHaveLength(1);
    expect(await boss.getSchedules(CONTENT_ASSEMBLY_QUEUE, "ES")).toHaveLength(1);
    expect(await boss.getSchedules(CONTENT_HEALTH_QUEUE, "ES")).toHaveLength(1);
    expect(await boss.getSchedules(NOTIFICATION_SCHEDULE_QUEUE, "ES")).toHaveLength(1);
    expect(await boss.getSchedules(NOTIFICATION_DELIVERY_QUEUE, "global")).toHaveLength(1);
    expect(await boss.getSchedules(PRIVACY_RETENTION_QUEUE, "global")).toHaveLength(1);

    const first = await boss.send(
      PUBLICATION_QUEUE,
      { localDate: "2026-07-28" },
      {
        singletonKey: "ES:2026-07-28",
      },
    );
    const duplicate = await boss.send(
      PUBLICATION_QUEUE,
      { localDate: "2026-07-28" },
      {
        singletonKey: "ES:2026-07-28",
      },
    );

    expect(first).toBeTypeOf("string");
    expect(duplicate).toBeNull();
  }, 15_000);
});
