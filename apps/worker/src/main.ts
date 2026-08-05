import {
  getAdminContentCalendar,
  claimDailyContentPlanRun,
  getContentGenerationHealth,
  getPublicationSettings,
  PostgresClient,
  purgeExpiredOperationalData,
  reconcileDueEditions,
} from "@ludico/database";
import { PgBoss } from "pg-boss";
import {
  addDays,
  ContentCircuitOpenError,
  ContentProviderCircuitBreaker,
  isMadridTimeDue,
  localDateInMadrid,
  missingEditionDates,
  runContentGenerationJob,
  runContentPlan,
  runEditionAssemblyWithFallback,
} from "./content-jobs.js";
import { fakeContentAssurance, fakeContentGenerator } from "./fake-content-generator.js";
import {
  configureQueues,
  configureSchedules,
  CONTENT_ASSEMBLY_QUEUE,
  CONTENT_GENERATION_QUEUE,
  CONTENT_HEALTH_QUEUE,
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
const configuredContentProvider = process.env.AI_PROVIDER ?? "deterministic";
if (
  !(["disabled", "deterministic", "fake"] as const).includes(configuredContentProvider as never)
) {
  throw new Error(
    "AI_PROVIDER no soportado; use deterministic, disabled o fake fuera de producción",
  );
}
if (configuredContentProvider === "fake" && process.env.NODE_ENV === "production") {
  throw new Error("AI_PROVIDER=fake no está permitido en producción");
}
// Disabled AI never disables the daily edition: use the deterministic reserve generator instead.
const contentProvider =
  configuredContentProvider === "disabled" ? "deterministic" : configuredContentProvider;
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
    const now = new Date();
    const settings = await getPublicationSettings(database);
    const today = localDateInMadrid(now);
    if (!isMadridTimeDue(now, settings.contentPlanLocalTime)) continue;
    if (!(await claimDailyContentPlanRun(database, today, now))) continue;
    await logLowReserve(job.id);
    const planned = await runContentPlan(
      database,
      today,
      contentProvider,
      Number(process.env.AI_JOB_BUDGET_MICROS ?? 0),
      settings.reserveDays,
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
await boss.work(CONTENT_HEALTH_QUEUE, async (jobs) => {
  for (const job of jobs) {
    const health = await getContentGenerationHealth(database, new Date());
    const log = JSON.stringify({ jobId: job.id, queue: CONTENT_HEALTH_QUEUE, ...health });
    if (health.alerts.length) console.error(log);
    else console.log(log);
  }
});
const contentGenerator = new ContentProviderCircuitBreaker(fakeContentGenerator);
if (contentProvider === "fake" || contentProvider === "deterministic") {
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
    const now = new Date();
    const settings = await getPublicationSettings(database);
    const today = localDateInMadrid(now);
    const targets = missingEditionDates(
      [today, addDays(today, 1)],
      (await getAdminContentCalendar(database)).editions,
    );
    const results = [];
    for (const targetDate of targets) {
      results.push(
        await runEditionAssemblyWithFallback(
          database,
          contentGenerator,
          fakeContentAssurance,
          targetDate,
          contentProvider,
          Number(process.env.AI_JOB_BUDGET_MICROS ?? 0),
          now,
          settings,
        ),
      );
    }
    const transitions = await reconcileDueEditions(database, now);
    console.log(
      JSON.stringify({ jobId: job.id, queue: CONTENT_ASSEMBLY_QUEUE, results, transitions }),
    );
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
