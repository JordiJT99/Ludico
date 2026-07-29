import { describe, expect, it } from "vitest";
import {
  assertEditionTransition,
  getEditionWindow,
  InvalidEditionTransitionError,
} from "./edition.js";

describe("edition lifecycle", () => {
  it("accepts the publication path and makes retries idempotent", () => {
    expect(() => assertEditionTransition("scheduled", "published")).not.toThrow();
    expect(() => assertEditionTransition("published", "published")).not.toThrow();
  });

  it("rejects transitions that bypass validation", () => {
    expect(() => assertEditionTransition("draft", "published")).toThrow(
      InvalidEditionTransitionError,
    );
  });
});

describe("edition calendar", () => {
  it.each([
    ["2026-03-29", 23],
    ["2026-10-25", 25],
    ["2026-07-28", 24],
  ])("uses Madrid civil days for %s", (date, expectedHours) => {
    const window = getEditionWindow(date);
    const hours = (window.closesAt.getTime() - window.opensAt.getTime()) / 3_600_000;

    expect(hours).toBe(expectedHours);
  });
});
