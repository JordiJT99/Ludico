import { describe, expect, it } from "vitest";
import { assessDifficulty, calculateObservedDifficulty } from "./difficulty.js";

describe("difficulty engine", () => {
  it("combines deterministic factors and only gives observed data weight after enough starts", () => {
    const lowSample = assessDifficulty(
      3,
      { knowledgeRarity: 0.5 },
      {
        completedStarts: 10,
        failureRate: 1,
      },
    );
    const established = assessDifficulty(
      3,
      { knowledgeRarity: 0.5 },
      {
        completedStarts: 200,
        failureRate: 1,
      },
    );

    expect(lowSample.confidence).toBe(0.05);
    expect(established.confidence).toBe(0.95);
    expect(established.validatedDifficulty).toBeGreaterThan(lowSample.validatedDifficulty);
  });

  it("normalizes observed difficulty and rejects invalid sample counts", () => {
    expect(calculateObservedDifficulty({ completedStarts: 100, failureRate: 0 })).toBe(1);
    expect(calculateObservedDifficulty({ completedStarts: 100, failureRate: 1 })).toBeGreaterThan(
      2,
    );
    expect(() => calculateObservedDifficulty({ completedStarts: -1, failureRate: 0.5 })).toThrow(
      RangeError,
    );
  });
});
