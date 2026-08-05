# Difficulty engine

Difficulty is normalized to `VERY_EASY=1`, `EASY=2`, `MEDIUM=3`, `HARD=4`, `EXPERT=5`. A candidate stores target, generator estimate, validator estimate, observed estimate, confidence and named factors.

The prior score combines normalized lexical complexity (0.15), knowledge rarity (0.20), ambiguity (0.10), reasoning steps (0.15), expected time (0.15), historical failure (0.15) and hint usage (0.10), then clamps to 1–5. Type-specific features add crossword crossings/grid density, quiz distractor quality/options, word-search visual density and guess-word reveal schedule.

Observed difficulty uses the shared domain formula and only becomes public with 100 competitive scored attempts. It blends the game-specific failure rate, average completion time normalized to ten minutes, unfinished competitive starts and applicable hints. Before that threshold, reviews show aggregate score/time from 20 attempts but not a claimed real difficulty. Confidence is capped at 0.95 and grows with the scored cohort. This first calibration is descriptive; versioned generator recalibration remains a later operational step.
