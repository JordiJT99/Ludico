# Data model

## Core records

| Entity | Essential fields |
| --- | --- |
| `GameType` / `GameTemplate` | code, locale, difficulty profile, enabled, version |
| `GenerationPlan` | market, requested range, reserve target, theme mix, status, idempotency key |
| `GenerationJob` / `GenerationAttempt` | plan, type, date, provider/model, prompt version, state, lease, tokens, cost, errors |
| `GeneratedCandidate` | type, locale, target date, seed, public/private payload, state, quality, fingerprints, parent revision |
| `ValidationRun` / `ValidationIssue` | candidate, validator/version, outcome, finding, evidence, executed at |
| `DifficultyAssessment` | target, generated estimate, validated estimate, observed estimate, confidence, factors |
| `DailyEdition` / `EditionGame` | market, local date, lifecycle times, selected candidate and game |
| `ContentReserve` | type, locale, difficulty, eligible count, target and alert level |
| `ContentSource` / `ContentFingerprint` | URL/reference, checked/valid-until, temporal risk; normalized/content/entity hashes |
| `ProviderUsage` / `GenerationCost` | provider/model, request ID, token counts, micro-cost, duration |
| `AuditLog` | actor, action, target, reason, correlation ID, redacted metadata |

Game-specific tables are `WordBankEntry`, `Crossword`, `CrosswordEntry`, `CrosswordClue`, `CrosswordCell`, `Quiz`, `QuizQuestion`, `QuizOption`, `TrueFalseGame`, `GuessWordGame` and `WordSearch`/`WordSearchEntry`. Initial persistence may keep validated public/private schemas in JSONB while frequently queried facts, dates, state and fingerprints are indexed columns.

## Required extensions

The database supports `quiz`, `crossword`, `true_false`, `guess_word` and `word_search`. Candidate persistence uses `approved`, `pending_review`, `rejected` and `selected`; published edition lifecycle is stored separately in `daily_editions`. Typed attempt tables cover answers, crossword cells, guesses and word-search finds. Public and private payloads remain split, while job, validation, audit, source and cost records retain reproducibility.

`WordBankEntry` stores visible and comparison-normalized answers, category, locale, aliases, variants, source/risk flags, quality and validation version. Spanish normalization folds accents for comparison but preserves `Ñ` (it never becomes `N`). Grid letters are uppercase letters only unless a template explicitly permits compounds.

## Privacy and retention

Player analytics is aggregated by cohort; raw player identifiers are not copied into content records. Retain audit and cost records according to the product retention policy, and store no provider credentials or unredacted personal data in prompts.
