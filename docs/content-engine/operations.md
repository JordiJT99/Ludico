# Operations, reserve and observability

Reserve target is fourteen eligible future days per enabled type/difficulty/locale. Alerts are warning below ten, critical below five and emergency below two. Planning selects the gap and candidate surplus; it does not simply generate tomorrow's games.

When a normal provider fails, the adapter chain falls back. When validation or selection fails, use approved reserve; then a prevalidated deterministic emergency edition. Failures retain correlation ID, error class and redacted provider metadata for retry and diagnosis.

Metrics include `generation_jobs_total`, `generation_jobs_failed`, `generation_duration_seconds`, `validation_rejection_rate`, `content_reserve_days`, `provider_cost_total`, `crossword_generation_attempts`, `crossword_quality_score`, `difficulty_deviation`, `publication_failures` and `duplicate_detection_rate`. Alert on no edition tomorrow, low reserve, failed publication/close/solution, rejection rate over 50%, provider outage, excessive cost or duration and large expected/observed difficulty deviation.

Service endpoints require service authentication, role checks, rate limiting, request validation and idempotency keys. Public clients receive no future edition IDs or private answers. Scores are verified server-side and all administration actions are audited.
