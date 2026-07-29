import { describe, expect, it } from "vitest";
import { calculateStreak } from "./streak.js";

describe("streak", () => {
  it("deduplicates games per day and keeps a current run through yesterday", () => {
    expect(
      calculateStreak(
        ["2026-07-24", "2026-07-25", "2026-07-25", "2026-07-28", "2026-07-29"],
        "2026-07-30",
      ),
    ).toEqual({ best: 2, current: 2, lastCompletedDate: "2026-07-29" });
  });

  it("resets a stale current run but preserves the best", () => {
    expect(calculateStreak(["2026-03-28", "2026-03-29", "2026-03-30"], "2026-04-02")).toEqual({
      best: 3,
      current: 0,
      lastCompletedDate: "2026-03-30",
    });
  });
});
