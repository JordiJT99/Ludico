import type { EditionSchedule, GeneratedContentCandidate } from "@ludico/domain";
import { getEditionWindow } from "@ludico/domain";
import {
  assembleApprovedEdition,
  claimContentGenerationJob,
  ContentPipelineError,
  failContentGenerationJob,
  planContentReserveJobs,
  recordGeneratedContent,
  requeueEmergencyContentJobs,
  type ContentJob,
  type SqlClient,
} from "@ludico/database";

export interface ContentGeneratorPort {
  generate(job: ContentJob): Promise<{
    candidate: GeneratedContentCandidate;
    costMicros: number;
  }>;
}

export interface ContentAssurancePort {
  evaluate(candidate: GeneratedContentCandidate): Promise<boolean>;
  verifySources(candidate: GeneratedContentCandidate): Promise<boolean>;
}

interface CircuitState {
  blockedCalls: number;
  consecutiveFailures: number;
  failures: number;
  halfOpenProbe: boolean;
  openUntil: number;
  opens: number;
  successes: number;
}

export interface ContentCircuitSnapshot {
  readonly blockedCalls: number;
  readonly failures: number;
  readonly key: string;
  readonly opens: number;
  readonly retryAt: string | null;
  readonly state: "closed" | "half_open" | "open";
  readonly successes: number;
}

export class ContentCircuitOpenError extends Error {
  readonly code = "CONTENT_PROVIDER_CIRCUIT_OPEN";

  constructor(readonly retryAt: string) {
    super("CONTENT_PROVIDER_CIRCUIT_OPEN");
    this.name = "ContentCircuitOpenError";
  }
}

export class ContentProviderCircuitBreaker implements ContentGeneratorPort {
  private readonly states = new Map<string, CircuitState>();

  constructor(
    private readonly generator: ContentGeneratorPort,
    private readonly options: Readonly<{
      failureThreshold?: number;
      now?: () => number;
      resetAfterMs?: number;
    }> = {},
  ) {
    if ((options.failureThreshold ?? 3) < 1 || (options.resetAfterMs ?? 60_000) < 1) {
      throw new RangeError("Configuración de circuit breaker inválida");
    }
  }

  async generate(job: ContentJob) {
    const key = `${job.provider}:${job.contentType}`;
    const state = this.getState(key);
    const now = (this.options.now ?? Date.now)();
    if (state.openUntil > now || state.halfOpenProbe) {
      state.blockedCalls += 1;
      throw new ContentCircuitOpenError(new Date(state.openUntil).toISOString());
    }
    const halfOpen = state.openUntil > 0;
    if (halfOpen) state.halfOpenProbe = true;
    try {
      const result = await this.generator.generate(job);
      state.successes += 1;
      state.consecutiveFailures = 0;
      state.halfOpenProbe = false;
      state.openUntil = 0;
      return result;
    } catch (error) {
      state.failures += 1;
      state.consecutiveFailures += 1;
      state.halfOpenProbe = false;
      if (halfOpen || state.consecutiveFailures >= (this.options.failureThreshold ?? 3)) {
        state.opens += 1;
        state.openUntil = now + (this.options.resetAfterMs ?? 60_000);
      }
      throw error;
    }
  }

  snapshot(): readonly ContentCircuitSnapshot[] {
    const now = (this.options.now ?? Date.now)();
    return [...this.states.entries()].map(([key, state]) => ({
      blockedCalls: state.blockedCalls,
      failures: state.failures,
      key,
      opens: state.opens,
      retryAt: state.openUntil ? new Date(state.openUntil).toISOString() : null,
      state:
        state.openUntil > now
          ? "open"
          : state.openUntil > 0 || state.halfOpenProbe
            ? "half_open"
            : "closed",
      successes: state.successes,
    }));
  }

  private getState(key: string): CircuitState {
    const state = this.states.get(key) ?? {
      blockedCalls: 0,
      consecutiveFailures: 0,
      failures: 0,
      halfOpenProbe: false,
      openUntil: 0,
      opens: 0,
      successes: 0,
    };
    this.states.set(key, state);
    return state;
  }
}

export async function runContentGenerationJob(
  database: SqlClient,
  generator: ContentGeneratorPort,
  assurance: ContentAssurancePort,
  jobId: string,
  now: Date,
) {
  const job = await claimContentGenerationJob(database, jobId, now);
  if (!job) return { status: "skipped" as const };
  try {
    const generated = await generator.generate(job);
    const [evaluatorPassed, sourcesVerified] = await Promise.all([
      assurance.evaluate(generated.candidate),
      assurance.verifySources(generated.candidate),
    ]);
    const content = await recordGeneratedContent(
      database,
      job.id,
      generated.candidate,
      { evaluatorPassed, sourcesVerified },
      generated.costMicros,
      now,
    );
    return { contentId: content.id, status: content.status };
  } catch (error) {
    await failContentGenerationJob(database, job.id, errorCode(error), now);
    throw error;
  }
}

export async function runContentPlan(
  database: SqlClient,
  today: string,
  provider: string,
  budgetMicros: number,
  reserveDays = 14,
) {
  return planContentReserveJobs(database, addDays(today, 1), provider, budgetMicros, {
    reserveDays,
  });
}

export function runEditionAssembly(
  database: SqlClient,
  localDate: string,
  now: Date,
  schedule?: EditionSchedule,
) {
  const { opensAt, closesAt } = getEditionWindow(localDate, "Europe/Madrid", schedule);
  return assembleApprovedEdition(database, localDate, opensAt, closesAt, now);
}

export async function runEditionAssemblyWithFallback(
  database: SqlClient,
  generator: ContentGeneratorPort,
  assurance: ContentAssurancePort,
  localDate: string,
  provider: string,
  budgetMicros: number,
  now: Date,
  schedule?: EditionSchedule,
) {
  try {
    return { emergency: false, ...(await runEditionAssembly(database, localDate, now, schedule)) };
  } catch (error) {
    if (
      !(error instanceof ContentPipelineError) ||
      error.code !== "INSUFFICIENT_APPROVED_CONTENT"
    ) {
      throw error;
    }
  }
  const jobs = await requeueEmergencyContentJobs(database, localDate, provider, budgetMicros, now);
  for (const job of jobs) {
    await runContentGenerationJob(database, generator, assurance, job.id, now);
  }
  return {
    emergency: true,
    ...(await runEditionAssembly(database, localDate, now, schedule)),
  };
}

export function localDateInMadrid(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function isMadridTime(now: Date, localTime: string): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.hour}:${value.minute}` === localTime;
}

export function isMadridTimeDue(now: Date, localTime: string): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.hour}:${value.minute}` >= localTime;
}

export function addDays(localDate: string, offset: number): string {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

export function missingEditionDates(
  dates: readonly string[],
  editions: readonly { readonly localDate: string; readonly status: string }[],
): readonly string[] {
  const existing = new Set(editions.map((edition) => edition.localDate));
  return dates.filter((date) => !existing.has(date));
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code).slice(0, 80);
  }
  return "GENERATION_FAILED";
}
