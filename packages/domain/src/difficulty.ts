export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export interface DifficultyFactors {
  readonly ambiguity?: number;
  readonly expectedTime?: number;
  readonly historicalFailureRate?: number;
  readonly hintUsageRate?: number;
  readonly knowledgeRarity?: number;
  readonly lexicalComplexity?: number;
  readonly reasoningSteps?: number;
}

export interface DifficultyAssessment {
  readonly confidence: number;
  readonly estimatedDifficulty: number;
  readonly factors: Readonly<Record<keyof DifficultyFactors, number>>;
  readonly observedDifficulty?: number;
  readonly targetDifficulty: DifficultyLevel;
  readonly validatedDifficulty: number;
}

export interface ObservedDifficultyInput {
  readonly abandonmentRate?: number;
  readonly completedStarts: number;
  readonly failureRate: number;
  readonly hintUsageRate?: number;
  readonly normalizedMedianTime?: number;
}

const factorWeights = {
  ambiguity: 0.1,
  expectedTime: 0.15,
  historicalFailureRate: 0.15,
  hintUsageRate: 0.1,
  knowledgeRarity: 0.2,
  lexicalComplexity: 0.15,
  reasoningSteps: 0.15,
} as const;

export function assessDifficulty(
  targetDifficulty: DifficultyLevel,
  factors: DifficultyFactors,
  observed?: ObservedDifficultyInput,
): DifficultyAssessment {
  assertLevel(targetDifficulty);
  const normalizedFactors = Object.fromEntries(
    Object.entries(factorWeights).map(([key, weight]) => {
      const factor = key as keyof DifficultyFactors;
      return [factor, clamp01(factors[factor] ?? 0.5) * weight];
    }),
  ) as Record<keyof DifficultyFactors, number>;
  const estimatedDifficulty = roundDifficulty(
    1 + 4 * Object.values(normalizedFactors).reduce((sum, value) => sum + value, 0),
  );
  const observedDifficulty = observed ? calculateObservedDifficulty(observed) : undefined;
  const confidence = observed ? Math.min(0.95, observed.completedStarts / 200) : 0.35;
  const validatedDifficulty = roundDifficulty(
    observedDifficulty === undefined
      ? estimatedDifficulty
      : estimatedDifficulty * (1 - confidence) + observedDifficulty * confidence,
  );
  return {
    confidence: round(confidence),
    estimatedDifficulty,
    factors: normalizedFactors,
    ...(observedDifficulty === undefined ? {} : { observedDifficulty }),
    targetDifficulty,
    validatedDifficulty,
  };
}

export function calculateObservedDifficulty(input: ObservedDifficultyInput): number {
  if (!Number.isInteger(input.completedStarts) || input.completedStarts < 0) {
    throw new RangeError("El nÃºmero de partidas completadas no es vÃ¡lido");
  }
  const failure = clamp01(input.failureRate);
  const time = clamp01(input.normalizedMedianTime ?? failure);
  const abandonment = clamp01(input.abandonmentRate ?? 0);
  const hints = clamp01(input.hintUsageRate ?? 0);
  return roundDifficulty(1 + 4 * (failure * 0.45 + time * 0.25 + abandonment * 0.2 + hints * 0.1));
}

function assertLevel(value: number): asserts value is DifficultyLevel {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new RangeError("La dificultad debe estar entre 1 y 5");
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function roundDifficulty(value: number): number {
  return round(Math.max(1, Math.min(5, value)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
