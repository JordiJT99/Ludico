# Crossword specification

## Input and word bank

The generator receives dimensions, min/max words, density range, target difficulty, theme, seed, proper-noun/abbreviation/compound policy and a bounded attempt count. A bank entry has a unique ID, answer, normalized answer, clue alternatives, category, Spanish locale, length/letters, accepted variants, source, factual/safety flags and quality score.

Words are uppercase NFC. Comparison folds accents; `Ñ` remains `Ñ`. In the MVP grid rejects punctuation and spaces. Compound answers are allowed only by a template that defines display and comparison rules.

## Algorithm

1. Filter bank by language, policy, quality, recent-use window and target difficulty.
2. Rank by length, letter connectivity and variety; deterministically shuffle ties from the seed.
3. Place a long anchor near the centre.
4. Run bounded backtracking over valid perpendicular crossings, with candidate score favouring intersections, compactness, balance and target difficulty.
5. Restart with deterministic derived seeds; optionally retain the best beam of partial grids.
6. Normalize bounds, number starts row-major, build public cells/blocks and private answers.
7. Reconstruct and validate before accepting the grid.

Placements must be connected, in bounds, conflict-free and separated from parallel accidental words. The candidate must not create adjacent un-clued letter runs. Search limits are explicit and failure returns `NO_LAYOUT`, never a partial puzzle.

## Quality and validation

`quality = connectivity + intersections + density + symmetry + clueBalance + difficultyMatch - isolatedRegions - accidentalWords - blackCells - excessiveShortWords`.

Minimum quality, density and horizontal/vertical balance are template configuration. Validation verifies dimensions, every answer/cell/entry, clue numbering, unique answer mapping, a single connected region, exact solution reconstruction, no duplicate word, safe text, factual source where needed and a minimum quality score.

Difficulty profiles use 7–8 cells / 6–10 common direct entries at level 1 through 14–15 cells / 24–40 specialist entries at level 5. These are configuration defaults; failed layouts may reduce entry count only within the declared profile, not silently change target difficulty.
