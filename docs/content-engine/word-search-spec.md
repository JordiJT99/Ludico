# Word-search specification

The generator accepts theme, target difficulty, dimensions, permitted directions, word count, seed and a word bank. It places each normalized word using a seeded order and bounded backtracking, then fills remaining cells from a locale alphabet. It returns word list, start/end coordinates, direction, grid and private solution.

Level 1 uses a 6×6 grid with three horizontal/vertical forward words. Level 2 uses 8×8 with five words and limited diagonal placement. Levels 3, 4 and 5 use 10×10/six words, 12×12/seven words and 14×14/eight words respectively; they progressively introduce reverse and all diagonal directions, larger search space and more distracting filler.

Validation reconstructs every listed word from its coordinates, verifies bounds and directions, rejects duplicate terms and unsafe accidental terms, and checks that serialization preserves the solution. Words are never sent as hidden coordinates in the public playable payload before closure.
