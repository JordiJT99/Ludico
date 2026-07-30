# Testing plan

Unit tests cover Spanish normalization, lifecycle transitions, date boundaries, difficulty, fingerprints, blocked terms, clue/option rules, placement, intersections, numbering, density and solution reconstruction. Property tests generate hundreds of seeds and assert crossword and word-search invariants, bounds, determinism and JSON round trips.

Integration tests exercise PostgreSQL claims, duplicated jobs, validation persistence, selection, providers and fallback. End-to-end tests create a plan, generate, validate, approve, schedule, publish, play, close, publish solutions and aggregate difficulty.

Resilience tests cover provider outages, exhausted budget, duplicated execution, worker restart, temporary database failure, low reserve and both DST transitions. Security tests assert that public API payloads omit solutions, admin endpoints reject unauthorized access and prompts/audits contain no configured secrets.

Every slice adds its acceptance tests and documents result, command and fixture. Deterministic tests use fixed seeds and explicit `Europe/Madrid` instants.
