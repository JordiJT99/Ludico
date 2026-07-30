# Internal API contracts

All internal endpoints require service authentication, role authorization, an `Idempotency-Key` for mutations and an audit correlation ID. Responses never expose private solutions.

| Endpoint | Action |
| --- | --- |
| `POST /internal/generation/plans` | create/reconcile plan |
| `POST /internal/generation/jobs` | enqueue a bounded job |
| `POST /internal/generation/{crosswords,quizzes,word-searches,true-false,guess-word}` | generate typed candidate |
| `POST /internal/validation/run` | run versioned validation |
| `POST /internal/content/:id/{approve,reject,regenerate,schedule,publish}` | audited moderation or publication action |
| `GET /internal/content/reserve` | reserve by type/difficulty/locale |
| `GET /internal/content/calendar` | operational edition calendar |
| `GET /internal/generation/metrics` | quality, costs and health |

Mutation payloads specify expected version where applicable. Conflicts return `409`; invalid state transitions return `422`; duplicate idempotency keys return the original successful response. Manual content changes require a reason of at least ten non-whitespace characters.
