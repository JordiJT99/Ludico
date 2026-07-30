# Quiz, true/false and guess-word specification

## Quiz

A quiz contains title, description, category, target difficulty, expected duration and questions. A question has statement, exactly four shuffled options, exactly one private correct ID, explanation, source, temporal risk, validity date, tags and per-question difficulty. Structural validation rejects duplicate options, answer leaks, unbalanced correct-option positions, double negatives, implausibly long-answer patterns and non-unique answers.

Fact claims require a source and checked date. High temporal-risk content is revalidated before publication. Stable cultural/scientific facts are preferred for automatic daily content.

## True or false

Each item stores statement, boolean solution, explanation, source, category, difficulty, temporal risk and checked date. Selection balances true/false without a predictable sequence. It rejects vague exceptions, unsupported absolutes and false claims that differ only by an irrelevant detail.

## Guess word

Each item has answer, normalized answer, precise definition, progressive hints, category, difficulty, attempts, allowed characters and accepted alternatives. Validation rejects definitions with more than one reasonable answer. Hint scheduling, length, frequency and letter reveals contribute to difficulty.
