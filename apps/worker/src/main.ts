import {
  getAdminContentCalendar,
  PostgresClient,
  purgeExpiredOperationalData,
  reconcileDueEditions,
} from "@ludico/database";
import { PgBoss } from "pg-boss";
import {
  addDays,
  ContentCircuitOpenError,
  ContentProviderCircuitBreaker,
  localDateInMadrid,
  runContentGenerationJob,
  runContentPlan,
  runEditionAssembly,
} from "./content-jobs.js";
import { fakeContentAssurance, fakeContentGenerator } from "./fake-content-generator.js";
import {
  configureQueues,
  configureSchedules,
  CONTENT_ASSEMBLY_QUEUE,
  CONTENT_GENERATION_QUEUE,
  CONTENT_PLAN_QUEUE,
  PUBLICATION_QUEUE,
  NOTIFICATION_DELIVERY_QUEUE,
  NOTIFICATION_SCHEDULE_QUEUE,
  PRIVACY_RETENTION_QUEUE,
} from "./jobs.js";
import {
  ExpoPushProvider,
  fakePushProvider,
  runNotificationDeliveryBatch,
  runNotificationScheduler,
} from "./notification-jobs.js";
import { lowReserveAlert } from "./reserve-alert.js";
import { isValidPushEncryptionKey } from "@ludico/database";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL es obligatoria");

const boss = new PgBoss({ application_name: "ludico-worker", connectionString });
const database = new PostgresClient(connectionString);
const contentProvider = process.env.AI_PROVIDER ?? "disabled";
if (contentProvider !== "disabled" && contentProvider !== "fake") {
  throw new Error("AI_PROVIDER no soportado; use disabled o fake fuera de producción");
}
const pushProviderName = process.env.PUSH_PROVIDER ?? "disabled";
if (!(["disabled", "expo", "fake"] as const).includes(pushProviderName as never)) {
  throw new Error("PUSH_PROVIDER no soportado; use disabled, expo o fake");
}
if (pushProviderName === "fake" && process.env.NODE_ENV === "production") {
  throw new Error("PUSH_PROVIDER=fake no está permitido en producción");
}
const pushEncryptionKey = process.env.NOTIFICATION_TOKEN_KEY_BASE64;
if (pushProviderName !== "disabled" && !isValidPushEncryptionKey(pushEncryptionKey)) {
  throw new Error("NOTIFICATION_TOKEN_KEY_BASE64 debe contener 32 bytes en base64");
}
const pushProvider =
  pushProviderName === "expo"
    ? new ExpoPushProvider(process.env.EXPO_ACCESS_TOKEN)
    : fakePushProvider;
boss.on("error", (error) => console.error(error));
boss.on("warning", (warning) => console.warn(warning));

await boss.start();
await configureQueues(boss);
await configureSchedules(boss, { notifications: pushProviderName !== "disabled" });
await boss.work(PUBLICATION_QUEUE, async (jobs) => {
  for (const job of jobs) {
    const transitions = await reconcileDueEditions(database, new Date());
    console.log(
      JSON.stringify({ jobId: job.id, queue: PUBLICATION_QUEUE, transitions: transitions.length }),
    );
  }
});
await boss.work(PRIVACY_RETENTION_QUEUE, async (jobs) => {
  for (const job of jobs) {
    const result = await purgeExpiredOperationalData(database, new Date());
    console.log(JSON.stringify({ jobId: job.id, queue: PRIVACY_RETENTION_QUEUE, result }));
  }
});
await boss.work(CONTENT_PLAN_QUEUE, async (jobs) => {
  for (const job of jobs) {
    await logLowReserve(job.id);
    if (contentProvider === "disabled") {
      console.log(JSON.stringify({ jobId: job.id, queue: CONTENT_PLAN_QUEUE, status: "disabled" }));
      continue;
    }
    const planned = await runContentPlan(
      database,
      localDateInMadrid(new Date()),
      contentProvider,
      Number(process.env.AI_JOB_BUDGET_MICROS ?? 0),
    );
    for (const contentJob of planned) {
      await boss.send(
        CONTENT_GENERATION_QUEUE,
        { jobId: contentJob.id },
        { singletonKey: contentJob.id },
      );
    }
    console.log(
      JSON.stringify({ jobId: job.id, planned: planned.length, queue: CONTENT_PLAN_QUEUE }),
    );
  }
});
if (contentProvider === "fake") {
  const contentGenerator = new ContentProviderCircuitBreaker(fakeContentGenerator);
  await boss.work(CONTENT_GENERATION_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const jobId = (job.data as { jobId?: unknown }).jobId;
      if (typeof jobId !== "string") throw new Error("CONTENT_JOB_ID_REQUIRED");
      try {
        const result = await runContentGenerationJob(
          database,
          contentGenerator,
          fakeContentAssurance,
          jobId,
          new Date(),
        );
        console.log(
          JSON.stringify({
            circuit: contentGenerator.snapshot(),
            jobId,
            queue: CONTENT_GENERATION_QUEUE,
            result,
          }),
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            circuit: contentGenerator.snapshot(),
            errorCode:
              error instanceof ContentCircuitOpenError ? error.code : "CONTENT_GENERATION_FAILED",
            jobId,
            queue: CONTENT_GENERATION_QUEUE,
          }),
        );
        throw error;
      }
    }
  });
}
await boss.work(CONTENT_ASSEMBLY_QUEUE, async (jobs) => {
  for (const job of jobs) {
    const targetDate = addDays(localDateInMadrid(new Date()), 1);
    const result = await runEditionAssembly(database, targetDate, new Date());
    console.log(JSON.stringify({ jobId: job.id, queue: CONTENT_ASSEMBLY_QUEUE, result }));
  }
});
if (pushProviderName !== "disabled" && pushEncryptionKey) {
  await boss.work(NOTIFICATION_SCHEDULE_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const result = await runNotificationScheduler(database, new Date());
      console.log(JSON.stringify({ jobId: job.id, queue: NOTIFICATION_SCHEDULE_QUEUE, ...result }));
    }
  });
  await boss.work(NOTIFICATION_DELIVERY_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const result = await runNotificationDeliveryBatch(
        database,
        pushProvider,
        pushEncryptionKey,
        new Date(),
      );
      console.log(JSON.stringify({ jobId: job.id, queue: NOTIFICATION_DELIVERY_QUEUE, ...result }));
    }
  });
}

const stop = async () => {
  await boss.stop({ graceful: true, timeout: 30_000 });
  await database.close();
};

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

async function logLowReserve(jobId: string): Promise<void> {
  const alert = lowReserveAlert((await getAdminContentCalendar(database)).reserve);
  if (alert) console.error(JSON.stringify({ ...alert, jobId, queue: CONTENT_PLAN_QUEUE }));
}
