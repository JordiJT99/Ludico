import { describe, expect, it, vi } from "vitest";
import {
  ContentCircuitOpenError,
  ContentProviderCircuitBreaker,
  FallbackContentGenerator,
  isMadridTime,
  isMadridTimeDue,
  missingEditionDates,
  type ContentGeneratorPort,
} from "./content-jobs.js";
import { lowReserveAlert } from "./reserve-alert.js";

describe("content provider circuit breaker", () => {
  it("uses the curated generator when the primary provider fails", async () => {
    const fallback = new FallbackContentGenerator(
      { generate: vi.fn<ContentGeneratorPort["generate"]>(async () => Promise.reject(new Error())) },
      {
        generate: vi.fn<ContentGeneratorPort["generate"]>(async () => ({
          candidate: {} as never,
          costMicros: 0,
          origin: "curated",
        })),
      },
    );
    await expect(fallback.generate(job("quiz"))).resolves.toMatchObject({ origin: "curated" });
  });

  it("records provider failures before falling back", async () => {
    const primary = new ContentProviderCircuitBreaker(
      { generate: vi.fn<ContentGeneratorPort["generate"]>(async () => Promise.reject(new Error())) },
      { failureThreshold: 1 },
    );
    const fallback = new FallbackContentGenerator(primary, {
      generate: vi.fn<ContentGeneratorPort["generate"]>(async () => ({
        candidate: {} as never,
        costMicros: 0,
        origin: "curated",
      })),
    });
    await fallback.generate(job("quiz"));
    await fallback.generate(job("quiz"));
    expect(primary.snapshot()).toContainEqual(
      expect.objectContaining({ blockedCalls: 1, failures: 1, state: "open" }),
    );
  });

  it("opens per provider/type, blocks calls, then closes after one successful probe", async () => {
    let now = Date.parse("2026-07-29T12:00:00Z");
    let fail = true;
    const generate = vi.fn<ContentGeneratorPort["generate"]>(async () => {
      if (fail) throw new Error("provider unavailable");
      return { candidate: {} as never, costMicros: 0 };
    });
    const breaker = new ContentProviderCircuitBreaker(
      { generate },
      { failureThreshold: 3, now: () => now, resetAfterMs: 1_000 },
    );
    const quiz = job("quiz");

    await expect(breaker.generate(quiz)).rejects.toThrow("provider unavailable");
    await expect(breaker.generate(quiz)).rejects.toThrow("provider unavailable");
    await expect(breaker.generate(quiz)).rejects.toThrow("provider unavailable");
    await expect(breaker.generate(quiz)).rejects.toBeInstanceOf(ContentCircuitOpenError);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(breaker.snapshot()).toContainEqual(
      expect.objectContaining({
        blockedCalls: 1,
        failures: 3,
        key: "primary:quiz",
        opens: 1,
        state: "open",
      }),
    );

    await expect(breaker.generate(job("crossword"))).rejects.toThrow("provider unavailable");
    expect(generate).toHaveBeenCalledTimes(4);

    now += 1_000;
    fail = false;
    await expect(breaker.generate(quiz)).resolves.toMatchObject({ costMicros: 0 });
    expect(breaker.snapshot()).toContainEqual(
      expect.objectContaining({ key: "primary:quiz", state: "closed", successes: 1 }),
    );
  });

  it("rejects nonsensical thresholds", () => {
    expect(
      () => new ContentProviderCircuitBreaker({ generate: vi.fn() }, { failureThreshold: 0 }),
    ).toThrow(RangeError);
  });
});

describe("content reserve alert", () => {
  it("alerts when either game reserve drops below ten days", () => {
    const healthy = { crossword: 10, quiz: 10, true_false: 10, guess_word: 10, word_search: 10 };
    expect(lowReserveAlert(healthy)).toBeNull();
    expect(lowReserveAlert({ ...healthy, crossword: 9, quiz: 12 })).toEqual({
      code: "CONTENT_RESERVE_LOW",
      reserve: { ...healthy, crossword: 9, quiz: 12 },
      severity: "warning",
      thresholdDays: 10,
    });
    expect(lowReserveAlert({ ...healthy, word_search: 4 })).toMatchObject({
      severity: "critical",
      thresholdDays: 5,
    });
    expect(lowReserveAlert({ ...healthy, guess_word: 1 })).toMatchObject({
      severity: "emergency",
      thresholdDays: 2,
    });
  });
});

describe("edition recovery", () => {
  it("repairs the current and next edition without touching a published one", () => {
    expect(
      missingEditionDates(
        ["2026-08-03", "2026-08-04"],
        [
          { localDate: "2026-08-03", status: "published" },
          { localDate: "2026-08-02", status: "cancelled" },
        ],
      ),
    ).toEqual(["2026-08-04"]);
  });
});

describe("content plan schedule", () => {
  it("uses the configured Madrid minute across summer time", () => {
    const now = new Date("2026-07-29T00:30:00.000Z");
    expect(isMadridTime(now, "02:30")).toBe(true);
    expect(isMadridTime(now, "02:31")).toBe(false);
    expect(isMadridTimeDue(new Date("2026-07-29T00:35:00.000Z"), "02:30")).toBe(true);
  });
});

function job(contentType: "crossword" | "quiz") {
  return {
    budgetMicros: 100,
    contentType,
    id: `job-${contentType}`,
    promptVersion: "v1",
    provider: "primary",
    targetDate: "2026-08-03",
  };
}
