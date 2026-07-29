import { Temporal } from "@js-temporal/polyfill";
import type { NotificationPreferences } from "@ludico/contracts";

export type NotificationUseCase = "daily_digest" | "edition_available" | "previous_solution";

export function chooseNotificationUseCase(
  preferences: NotificationPreferences,
  available: Readonly<{ edition: boolean; previousSolution: boolean }>,
): NotificationUseCase | null {
  if (!preferences.enabled) return null;
  const edition = preferences.editionAvailable && available.edition;
  const solution = preferences.previousSolution && available.previousSolution;
  return edition && solution
    ? "daily_digest"
    : solution
      ? "previous_solution"
      : edition
        ? "edition_available"
        : null;
}

export function nextAllowedNotificationTime(
  now: Date,
  preferences: Pick<NotificationPreferences, "quietEnd" | "quietStart" | "timeZone">,
): Date {
  const current = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(
    preferences.timeZone,
  );
  const start = Temporal.PlainTime.from(preferences.quietStart);
  const end = Temporal.PlainTime.from(preferences.quietEnd);
  if (Temporal.PlainTime.compare(start, end) === 0) return now;
  const time = current.toPlainTime();
  const overnight = Temporal.PlainTime.compare(start, end) > 0;
  const inside = overnight
    ? Temporal.PlainTime.compare(time, start) >= 0 || Temporal.PlainTime.compare(time, end) < 0
    : Temporal.PlainTime.compare(time, start) >= 0 && Temporal.PlainTime.compare(time, end) < 0;
  if (!inside) return now;
  const endDate =
    overnight && Temporal.PlainTime.compare(time, start) >= 0
      ? current.toPlainDate().add({ days: 1 })
      : current.toPlainDate();
  return new Date(
    endDate.toZonedDateTime({ plainTime: end, timeZone: preferences.timeZone }).toInstant()
      .epochMilliseconds,
  );
}

export function isWithinNotificationCap(
  previousDeliveries: readonly Date[],
  now: Date,
  timeZone: string,
): boolean {
  const current = Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();
  const weekStart = current.subtract({ days: current.dayOfWeek - 1 });
  let today = 0;
  let week = 0;
  for (const delivery of previousDeliveries) {
    const date = Temporal.Instant.fromEpochMilliseconds(delivery.getTime())
      .toZonedDateTimeISO(timeZone)
      .toPlainDate();
    if (date.equals(current)) today += 1;
    if (
      Temporal.PlainDate.compare(date, weekStart) >= 0 &&
      Temporal.PlainDate.compare(date, current) <= 0
    ) {
      week += 1;
    }
  }
  return today < 1 && week < 3;
}

export function isValidTimeZone(value: string): boolean {
  try {
    Temporal.Now.instant().toZonedDateTimeISO(value);
    return true;
  } catch {
    return false;
  }
}
