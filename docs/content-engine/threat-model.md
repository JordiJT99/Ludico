# Threat model

| Threat | Control |
| --- | --- |
| Solution disclosure or score forgery | private solution table, server verification, state-gated APIs |
| Predictable/future content enumeration | UUIDs, authorization, no future public IDs |
| Admin abuse | roles, rate limits, reason and immutable audit log |
| Prompt injection/provider outage | typed schema, no secret interpolation, circuit breaker and deterministic fallback |
| Unsafe or copied content | ordered moderation, source policy, duplicate/entity checks and manual review |
| Duplicate jobs/DST race | idempotency keys, transaction locks, Temporal local-day boundaries |
| Cost exhaustion | budgets, usage records, limits and fallback |
| Personal-data leakage | minimized analytics, redaction and retention controls |
