# Operations, reserve and observability

Reserve target is fourteen eligible future days per enabled type/difficulty/locale, plus one candidate in flight. Alerts are warning below ten, critical below five and emergency below two. Planning counts approved reserve and queued/running work independently, then schedules only the missing candidates within a twenty-one-day horizon.

When normal selection fails, the worker uses approved reserve first. If one type has no approved candidate, it requeues a versioned deterministic emergency candidate, applies the same validation pipeline and retries assembly. Failures retain correlation ID, error class and redacted provider metadata for retry and diagnosis.

Metrics include `generation_jobs_total`, `generation_jobs_failed`, `generation_duration_seconds`, `validation_rejection_rate`, `content_reserve_days`, `provider_cost_total`, `crossword_generation_attempts`, `crossword_quality_score`, `difficulty_deviation`, `publication_failures` and `duplicate_detection_rate`. Alert on no edition tomorrow, low reserve, failed publication/close/solution, rejection rate over 50%, provider outage, excessive cost or duration and large expected/observed difficulty deviation.

The MVP worker emits an aggregate health snapshot every fifteen minutes: reserve by type, queue/running/failed counts, current-day provider cost and whether tomorrow is assembled. It contains neither player data nor content payloads and is also available to authorised backoffice users.

Service endpoints require service authentication, role checks, rate limiting, request validation and idempotency keys. Public clients receive no future edition IDs or private answers. Scores are verified server-side and all administration actions are audited.
