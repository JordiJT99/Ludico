# Generation and validation contracts

## Shared context

`GenerationContext` includes `requestId`, idempotency key, target date, locale, difficulty, theme constraints, seed, provider budget and banned entities. `ValidationContext` includes policy/version, blocked terms, recent fingerprints, source policy, difficulty profile and current date.

Every generator returns a typed `publicPayload`, a separate typed `privatePayload`, sources, metadata and a deterministic seed. Every validator returns `{ status, findings, score, version, evidence }`, where status is pass, review or reject. A reject cannot be manually auto-approved without a new validation run.

## Common metadata

```ts
type GenerationMetadata = {
  seed: string; provider: string; model?: string; promptVersion: string;
  generatorVersion: string; generatedAt: string; tokensIn?: number;
  tokensOut?: number; costMicros: number;
};
type DifficultyAssessment = {
  targetDifficulty: 1 | 2 | 3 | 4 | 5;
  estimatedDifficulty: number; validatedDifficulty: number;
  observedDifficulty?: number; confidence: number;
  factors: Record<string, number>;
};
```

Content schemas reject unknown critical fields, invalid identifiers, missing sources for factual items and any answer included in public payload. Game validators also verify their own reconstructible solution.
