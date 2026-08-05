# Automation flow and scheduled jobs

```mermaid
sequenceDiagram
  participant Scheduler
  participant Worker
  participant DB as PostgreSQL
  Scheduler->>Worker: PlanContentGenerationJob
  Worker->>DB: calculate reserve and enqueue idempotently
  Worker->>Worker: GenerateContentJob / ValidateContentJob
  Worker->>DB: persist candidate, findings and costs
  Worker->>DB: SelectBestCandidateJob / ScheduleEditionJob
  Scheduler->>Worker: PublishEditionJob / recovery sweep
  Worker->>DB: publish due edition atomically
  Scheduler->>Worker: CloseEditionJob / PublishSolutionsJob
  Worker->>DB: close, expose solutions, aggregate results
```

Required jobs: `PlanContentGenerationJob`, `GenerateContentJob`, `ValidateContentJob`, `SelectBestCandidateJob`, `ScheduleEditionJob`, `PublishEditionJob`, `CloseEditionJob`, `PublishSolutionsJob`, `RecalculateDifficultyJob`, `RefillContentReserveJob`, `DetectDuplicateContentJob`, `CleanFailedGenerationJob` and `GenerationHealthCheckJob`.

Nominal Madrid times are 01:00 reserve, 01:10 plan, 01:15 generation, 02:30 validation, 03:00 selection, 03:15 schedule, 23:55 readiness, 00:00 publish, 00:00 close previous edition and default solution publication, 00:10 rankings, 00:20 recalibration. Each operation is also a recurring reconciliation, never only a wall-clock action. The assembler checks both the current and next local edition; after a restart it repairs a missing current edition and immediately reconciles publication.
