import { PgBoss } from "pg-boss";

export const PUBLICATION_QUEUE = "publication.reconcile";
export const CONTENT_PLAN_QUEUE = "content.plan";
export const CONTENT_GENERATION_QUEUE = "content.generate";
export const CONTENT_ASSEMBLY_QUEUE = "content.assemble";
export const NOTIFICATION_SCHEDULE_QUEUE = "notification.schedule";
export const NOTIFICATION_DELIVERY_QUEUE = "notification.deliver";
export const PRIVACY_RETENTION_QUEUE = "privacy.retention";
export const DEAD_LETTER_QUEUE = "dead-letter";

export async function configureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(DEAD_LETTER_QUEUE);
  for (const queue of [
    PUBLICATION_QUEUE,
    CONTENT_PLAN_QUEUE,
    CONTENT_GENERATION_QUEUE,
    CONTENT_ASSEMBLY_QUEUE,
    NOTIFICATION_SCHEDULE_QUEUE,
    NOTIFICATION_DELIVERY_QUEUE,
    PRIVACY_RETENTION_QUEUE,
  ]) {
    await boss.createQueue(queue, {
      deadLetter: DEAD_LETTER_QUEUE,
      policy: "exclusive",
      retryBackoff: true,
      retryDelay: 5,
      retryDelayMax: 300,
      retryLimit: 5,
      warningQueueSize: 100,
    });
  }
}

export async function configureSchedules(
  boss: PgBoss,
  options: { notifications?: boolean } = {},
): Promise<void> {
  await boss.schedule(
    PUBLICATION_QUEUE,
    "* * * * *",
    { source: "schedule" },
    {
      key: "ES",
      singletonKey: "ES:reconcile",
      tz: "Europe/Madrid",
    },
  );
  await boss.schedule(
    CONTENT_PLAN_QUEUE,
    "0 2 * * *",
    { source: "schedule" },
    { key: "ES", singletonKey: "ES:content-plan", tz: "Europe/Madrid" },
  );
  await boss.schedule(
    CONTENT_ASSEMBLY_QUEUE,
    "*/15 * * * *",
    { source: "schedule" },
    { key: "ES", singletonKey: "ES:content-assemble", tz: "Europe/Madrid" },
  );
  await boss.schedule(
    PRIVACY_RETENTION_QUEUE,
    "30 3 * * *",
    { source: "schedule" },
    { key: "global", singletonKey: "privacy-retention", tz: "Europe/Madrid" },
  );
  if (options.notifications) {
    await boss.schedule(
      NOTIFICATION_SCHEDULE_QUEUE,
      "*/15 * * * *",
      { source: "schedule" },
      { key: "ES", singletonKey: "ES:notification-schedule", tz: "Europe/Madrid" },
    );
    await boss.schedule(
      NOTIFICATION_DELIVERY_QUEUE,
      "* * * * *",
      { source: "schedule" },
      { key: "global", singletonKey: "notification-delivery" },
    );
  }
}
