export interface ExperienceEvent {
  readonly amount: number;
  readonly kind: "completion" | "daily_double";
  readonly recordedAt: Date | string;
}

export interface PlayerProgression {
  readonly achievements: readonly {
    readonly earnedAt: string;
    readonly key: "daily-double" | "first-game";
  }[];
  readonly experience: number;
  readonly level: number;
  readonly nextLevelExperience: number;
  readonly version: "xp-v1";
}

export function experienceForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) throw new Error("INVALID_LEVEL");
  return 50 * level * (level - 1);
}

export function progressionFromEvents(events: readonly ExperienceEvent[]): PlayerProgression {
  const experience = events.reduce((total, event) => {
    if (!Number.isInteger(event.amount) || event.amount <= 0) throw new Error("INVALID_EXPERIENCE");
    return total + event.amount;
  }, 0);
  let level = 1;
  while (experience >= experienceForLevel(level + 1)) level += 1;
  const firstCompletion = events.find((event) => event.kind === "completion");
  const dailyDouble = events.find((event) => event.kind === "daily_double");
  return {
    achievements: [
      ...(firstCompletion
        ? [{ earnedAt: toIso(firstCompletion.recordedAt), key: "first-game" as const }]
        : []),
      ...(dailyDouble
        ? [{ earnedAt: toIso(dailyDouble.recordedAt), key: "daily-double" as const }]
        : []),
    ],
    experience,
    level,
    nextLevelExperience: experienceForLevel(level + 1),
    version: "xp-v1",
  };
}

function toIso(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_EXPERIENCE_DATE");
  return date.toISOString();
}
