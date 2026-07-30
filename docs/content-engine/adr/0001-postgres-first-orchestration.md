# ADR 0001: PostgreSQL-first orchestration

## Decision

Use the existing PostgreSQL jobs, conditional state transitions, transactions and row/advisory locks as the MVP orchestration substrate. Keep provider adapters and schedules in the worker.

## Rationale

The codebase already persists generation jobs, candidates, audit events and editions in PostgreSQL. Adding Redis or another queue before demonstrated need would duplicate operational state and increase recovery paths. This does not prevent a later queue adapter: job handlers and idempotency contracts remain independent.

## Consequences

Workers must keep claims short, lease work, recover expired jobs and use indexes on pending states. Long AI calls happen outside a transaction; persistence is re-entered with a state/version precondition.
