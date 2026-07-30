# Difficulty engine

Difficulty is normalized to `VERY_EASY=1`, `EASY=2`, `MEDIUM=3`, `HARD=4`, `EXPERT=5`. A candidate stores target, generator estimate, validator estimate, observed estimate, confidence and named factors.

The prior score combines normalized lexical complexity (0.15), knowledge rarity (0.20), ambiguity (0.10), reasoning steps (0.15), expected time (0.15), historical failure (0.15) and hint usage (0.10), then clamps to 1–5. Type-specific features add crossword crossings/grid density, quiz distractor quality/options, word-search visual density and guess-word reveal schedule.

Observed difficulty starts from failure rate (`1 + 4 * failureRate` for quiz) and blends completion, time percentile, abandonment, errors and hints. Cohort level and sample confidence prevent self-selection bias. Before the configured minimum sample size (default 100 completed starts), published difficulty remains the validated estimate; recalibration is gradual and versioned.
