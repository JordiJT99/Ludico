# Technical specification

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `content-orchestrator` | plan, claim, generate, validate, select and persist attempts |
| `content-scheduler` | enqueue recurring, catch-up and health jobs |
| `*-generator` | create game-specific candidate payloads, without HTTP concerns |
| `content-validator` | deterministic, semantic, factual, safety and duplicate checks |
| `difficulty-engine` | estimate and later recalibrate difficulty |
| `publication-engine` | convert selected candidates into editions and reconcile open/close/solutions |
| `content-reserve` | calculate shortage, alerts and emergency fallback |
| `generation-analytics` | aggregate outcomes, quality and provider costs |
| `provider-adapters` | AI, local, deterministic and prevalidated sources |

Domain code exposes these ports:

```ts
interface ContentGenerator<TConfig, TOutput> {
  generate(config: TConfig, context: GenerationContext): Promise<TOutput>;
}
interface ContentValidator<TContent> {
  validate(content: TContent, context: ValidationContext): Promise<ValidationResult>;
}
interface AIProvider {
  generateStructuredOutput<T>(request: StructuredGenerationRequest<T>): Promise<T>;
}
```

Adapters own JSON-schema validation, timeout, exponential backoff with jitter, circuit breaker, token/cost logging and provider/model version. An idempotency key is derived from generation plan, content type, target date, variant and prompt version. HTTP controllers only enqueue/query work; they never call an AI provider.

## Queue and locking design

The existing PostgreSQL job records and transaction locks are retained. Claiming changes `queued` to `running` conditionally; publishing uses `FOR UPDATE SKIP LOCKED`. A singleton job uses an advisory lock keyed by job name and market/date. All handlers are safe to retry because writes use unique keys and state preconditions.

Jobs are versioned (`job_type`, `schema_version`, payload) and cancellable before claim. A watchdog moves expired leases to retry with bounded attempts. Permanent errors are recorded and raise an alert rather than looping indefinitely.

## Provider fallback

Priority is configured as primary AI, secondary AI, local model, deterministic generator and prevalidated bank. A circuit opens after consecutive retriable errors, then permits one half-open probe after cooldown. Budget exhaustion skips expensive providers. Deterministic/prevalidated output receives the identical validation pipeline.

No provider secret is persisted in a prompt or audit payload. Only template/version, redacted request metadata, model, tokens, latency, status and cost are stored.
