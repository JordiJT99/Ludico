import { describe, expect, it } from "vitest";
import {
  chooseNotificationUseCase,
  isValidTimeZone,
  isWithinNotificationCap,
  nextAllowedNotificationTime,
} from "./notifications.js";

const preferences = {
  editionAvailable: true,
  enabled: true,
  previousSolution: true,
  quietEnd: "08:00",
  quietStart: "22:00",
  timeZone: "Europe/Madrid",
};

describe("notification policy", () => {
  it("combines two eligible reasons into one daily digest", () => {
    expect(chooseNotificationUseCase(preferences, { edition: true, previousSolution: true })).toBe(
      "daily_digest",
    );
    expect(
      chooseNotificationUseCase(
        { ...preferences, enabled: false },
        { edition: true, previousSolution: true },
      ),
    ).toBeNull();
  });

  it("moves an overnight quiet-hour delivery to the first valid instant across DST", () => {
    const beforeSpringChange = new Date("2026-03-28T22:30:00.000Z");
    expect(nextAllowedNotificationTime(beforeSpringChange, preferences).toISOString()).toBe(
      "2026-03-29T06:00:00.000Z",
    );
    const daytime = new Date("2026-03-29T10:00:00.000Z");
    expect(nextAllowedNotificationTime(daytime, preferences)).toEqual(daytime);
  });

  it("enforces one delivery per local day and three per local week", () => {
    const now = new Date("2026-08-06T10:00:00.000Z");
    expect(isWithinNotificationCap([], now, "Europe/Madrid")).toBe(true);
    expect(
      isWithinNotificationCap([new Date("2026-08-06T08:00:00.000Z")], now, "Europe/Madrid"),
    ).toBe(false);
    expect(
      isWithinNotificationCap(
        [
          new Date("2026-08-03T08:00:00.000Z"),
          new Date("2026-08-04T08:00:00.000Z"),
          new Date("2026-08-05T08:00:00.000Z"),
        ],
        now,
        "Europe/Madrid",
      ),
    ).toBe(false);
  });

  it("rejects unknown IANA zones", () => {
    expect(isValidTimeZone("Europe/Madrid")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
