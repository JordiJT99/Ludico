# Word-search specification

The generator accepts theme, target difficulty, dimensions, permitted directions, word count, seed and a word bank. It places each normalized word using a seeded order and bounded backtracking, then fills remaining cells from a locale alphabet. It returns word list, start/end coordinates, direction, grid and private solution.

Level 1 permits horizontal/vertical forward words in a small grid; level 2 introduces limited diagonal/reverse; levels 3–5 permit all directions, increasing size, overlap, thematic similarity and filler ambiguity.

Validation reconstructs every listed word from its coordinates, verifies bounds and directions, rejects duplicate terms and unsafe accidental terms, and checks that serialization preserves the solution. Words are never sent as hidden coordinates in the public playable payload before closure.
