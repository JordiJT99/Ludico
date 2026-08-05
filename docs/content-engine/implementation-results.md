# Implementation results

## Slice 1 — edition lifecycle

Implemented a recurring assembly recovery every fifteen minutes. Existing PostgreSQL reconciliation remains the single idempotent authority for publish, close and solution exposure. This eliminates the prior single daily assembly point as a recovery gap.

Verified with worker and database tests: 4 worker files / 8 tests and 15 database files / 37 tests passed.

## Slice 2 — curated crosswords

Extended the seeded constructor with configurable geometry, density, restart count and quality threshold. It now rejects duplicate normalized answers, measures density/intersections/balance/compactness and retains ambiguity detection separately for solution counting. Spanish accent folding is Unicode-based and preserves `Ñ`.

Verified with 12 deterministic seeds plus domain tests: 12 files / 38 tests passed.

## Slice 3/4 foundation

Quiz editorial validation now checks repeated prompts/options and answer-position concentration; contracts accept all five difficulty levels. Added a common difficulty engine and validated deterministic implementations for true/false, adivina la palabra and sopa de letras. The worker defaults to a rotating curated deterministic generator when no external provider is configured; it contains playable content rather than development fixtures, so an AI outage does not make daily editions repetitive or unavailable. `fake` remains prohibited in production.

## Slice 3/4 — content pipeline integration

The generation repository and job schema now accept the five MVP types. Planning creates a dated job per type, deterministic generation returns a typed candidate for each, validation checks its private/public split and provenance, and the backoffice reports the five reserve counts. The migration `0013_watery_black_tarantula` preserves existing rows while extending database checks.

`AI_PROVIDER=disabled` now explicitly selects the deterministic generator in the worker. Disabling an external AI provider therefore cannot leave the daily edition without fresh reserve content.

Daily edition assembly includes quiz, verdadero/falso, adivina la palabra, crucigrama and sopa de letras. Verdadero/falso uses the same server-verified question-attempt pipeline with an explicit three-to-twenty-question, two-option validation rule. Adivina la palabra has an isolated typed-answer attempt flow with idempotent guesses, a server-side score and no answer disclosure before close. Sopa de letras has an isolated coordinate-selection attempt: public payloads carry only the grid and word list; the server holds directions/coordinates, validates every selection and only reveals those coordinates after closing. Web and mobile players, personal review, data export and E2E coverage use the same contract.

## Difficulty observation

Closed-game reviews now calculate observed difficulty in the shared domain engine from competitive failure rate, median duration, unfinished starts and hint usage. Aggregate score and time require 20 competitive results; observed difficulty and confidence require 100, so a small cohort never presents a misleading calibration. The value is exposed only after the edition has closed and is rendered in both web and mobile reviews.

## Crossword target difficulty

The deterministic crossword constructor now filters the validated word bank by its requested target difficulty before search, rejects an invalid or undersupplied level and preserves the target in the public payload. This makes the configured level auditable without exposing answers; existing historical payloads remain valid when the optional field is absent.
