import type { StreakSummary } from "@ludico/contracts";
import { Temporal } from "@js-temporal/polyfill";

export function calculateStreak(completionDates: readonly string[], today: string): StreakSummary {
  const dates = [...new Set(completionDates)]
    .map((date) => Temporal.PlainDate.from(date))
    .sort(Temporal.PlainDate.compare);
  if (!dates.length) return { best: 0, current: 0, lastCompletedDate: null };

  let best = 1;
  let run = 1;
  for (let index = 1; index < dates.length; index += 1) {
    run = dates[index - 1]!.add({ days: 1 }).equals(dates[index]!) ? run + 1 : 1;
    best = Math.max(best, run);
  }

  const latest = dates.at(-1)!;
  const currentDate = Temporal.PlainDate.from(today);
  const active = latest.equals(currentDate) || latest.equals(currentDate.subtract({ days: 1 }));
  let current = active ? 1 : 0;
  for (let index = dates.length - 1; active && index > 0; index -= 1) {
    if (!dates[index - 1]!.add({ days: 1 }).equals(dates[index]!)) break;
    current += 1;
  }
  return { best, current, lastCompletedDate: latest.toString() };
}
