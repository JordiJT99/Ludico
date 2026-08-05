import { describe, expect, it } from "vitest";
import { experienceForLevel, progressionFromEvents } from "./progression.js";

describe("player progression", () => {
  it("uses a versioned triangular XP curve", () => {
    expect(experienceForLevel(1)).toBe(0);
    expect(experienceForLevel(2)).toBe(100);
    expect(experienceForLevel(3)).toBe(300);
    expect(() => experienceForLevel(0)).toThrow("INVALID_LEVEL");
  });

  it("derives cosmetic achievements from confirmed ledger events", () => {
    expect(
      progressionFromEvents([
        { amount: 100, kind: "completion", recordedAt: "2026-08-05T10:00:00.000Z" },
        { amount: 100, kind: "completion", recordedAt: "2026-08-05T10:05:00.000Z" },
        { amount: 200, kind: "daily_double", recordedAt: "2026-08-05T10:05:00.000Z" },
      ]),
    ).toEqual({
      achievements: [
        { earnedAt: "2026-08-05T10:00:00.000Z", key: "first-game" },
        { earnedAt: "2026-08-05T10:05:00.000Z", key: "daily-double" },
      ],
      experience: 400,
      level: 3,
      nextLevelExperience: 600,
      version: "xp-v1",
    });
  });
});
