# Consistency review

Reviewed against the master requirements before implementation.

| Potential contradiction | Resolution |
| --- | --- |
| Candidate has eleven requested states; existing edition has nine | Candidate workflow and published-edition lifecycle are separate models. Mapping is defined in `functional-spec.md`. |
| Close at 23:59:59 versus publish at 00:00 | The close boundary is the next local midnight calculated with Temporal. This is equivalent, DST-safe and atomically exposes solutions by default. |
| Fourteen-day minimum versus generation for 14–20 days ahead | Fourteen is the minimum eligible reserve, not a maximum horizon. Planning may generate surplus candidates further ahead. |
| AI must generate content but must keep working without it | Providers are optional adapters; deterministic and prevalidated fallback run the same validation pipeline. |
| Full automatic flow versus manual administration | Automation owns normal state changes; editorial actions create auditable revisions and cannot bypass deterministic failures. |
| No solution before close versus validation/review needs solutions | Private payload is available only to trusted worker/admin paths and is never serialized by public edition endpoints. |

No unresolved specification conflict blocks Slice 1.
