# Operations, reserve and observability

The current MVP keeps fourteen eligible future days for every enabled game type using its fixed, visible default difficulty profile, plus one candidate in flight. The stored job configuration already carries targetDifficulty; reserve partitioning by every difficulty and locale becomes active when alternate variants are enabled. Alerts are warning below ten, critical below five and emergency below two. Planning counts approved reserve and queued/running work independently, then schedules only the missing candidates within a twenty-one-day horizon.

The deterministic very-easy guess-word bank contains fourteen distinct curated answers, and a generator test enforces that its fourteen-day reserve does not repeat an answer. The word-search bank contains seventy curated words and assigns five disjoint words to each of fourteen consecutive editions.

When normal selection fails, the worker uses approved reserve first. If one type has no approved candidate, it requeues a versioned deterministic emergency candidate, applies the same validation pipeline and retries assembly. Failures retain correlation ID, error class and redacted provider metadata for retry and diagnosis.

To enable external drafts, set `AI_PROVIDER=openai` together with `OPENAI_API_KEY` and `OPENAI_CONTENT_MODEL` in the worker environment. Token-cost estimates are optional and set with `OPENAI_INPUT_TOKEN_MICROS` and `OPENAI_OUTPUT_TOKEN_MICROS`; keys are never stored in the database or prompts.

Metrics include `generation_jobs_total`, `generation_jobs_failed`, `generation_duration_seconds`, `validation_rejection_rate`, `content_reserve_days`, `provider_cost_total`, `crossword_generation_attempts`, `crossword_quality_score`, `difficulty_deviation`, `publication_failures` and `duplicate_detection_rate`. Alert on no edition tomorrow, low reserve, failed publication/close/solution, rejection rate over 50%, provider outage, excessive cost or duration and large expected/observed difficulty deviation.

The MVP worker emits an aggregate health snapshot every fifteen minutes: reserve by type, queue/running/failed counts, current-day provider cost and whether tomorrow is assembled. It contains neither player data nor content payloads and is also available to authorised backoffice users.

Service endpoints require service authentication, role checks, rate limiting, request validation and idempotency keys. Public clients receive no future edition IDs or private answers. Scores are verified server-side and all administration actions are audited.
