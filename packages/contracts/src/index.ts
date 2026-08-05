export const healthResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: { const: "ok" },
  },
} as const;

export type HealthResponse = { status: "ok" };

export interface PublicGame {
  readonly id: string;
  readonly type: "quiz" | "crossword" | "true_false" | "guess_word" | "word_search";
  readonly status: "active" | "disabled";
  readonly payload: object;
  readonly contentVersion: number;
}

export interface PublicEdition {
  readonly id: string;
  readonly localDate: string;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly games: readonly PublicGame[];
}

export const publicGameSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "status", "payload", "contentVersion"],
  properties: {
    id: { type: "string", format: "uuid" },
    type: { enum: ["quiz", "crossword", "true_false", "guess_word", "word_search"] },
    status: { enum: ["active", "disabled"] },
    payload: { type: "object", additionalProperties: true },
    contentVersion: { type: "integer", minimum: 1 },
  },
} as const;

export const publicEditionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "localDate", "opensAt", "closesAt", "games"],
  properties: {
    id: { type: "string", format: "uuid" },
    localDate: { type: "string", format: "date" },
    opensAt: { type: "string", format: "date-time" },
    closesAt: { type: "string", format: "date-time" },
    games: {
      type: "array",
      items: publicGameSchema,
    },
  },
} as const;

export function isPublicEdition(value: unknown): value is PublicEdition {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.localDate === "string" &&
    typeof value.opensAt === "string" &&
    typeof value.closesAt === "string" &&
    Array.isArray(value.games) &&
    value.games.every(
      (game) =>
        isRecord(game) &&
        typeof game.id === "string" &&
        (game.type === "quiz" ||
          game.type === "crossword" ||
          game.type === "true_false" ||
          game.type === "guess_word" ||
          game.type === "word_search") &&
        (game.status === "active" || game.status === "disabled") &&
        isRecord(game.payload) &&
        Number.isInteger(game.contentVersion),
    )
  );
}

export interface PublicSolution {
  readonly gameId: string;
  readonly game: PublicGame;
  readonly publishedAt: string;
  readonly payload: Record<string, unknown>;
  readonly statistics?: {
    readonly attemptCount: number;
    readonly averageDurationMs: number;
    readonly averageScore: number;
    readonly observedDifficulty?: number;
    readonly difficultyConfidence?: number;
    readonly crosswordEntries?: readonly {
      readonly entryId: string;
      readonly incorrectPercent: number;
    }[];
    readonly quizQuestions?: readonly {
      readonly correctPercent: number;
      readonly questionId: string;
    }[];
  };
}

export const publicSolutionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["gameId", "game", "publishedAt", "payload"],
  properties: {
    gameId: { type: "string", format: "uuid" },
    game: publicGameSchema,
    publishedAt: { type: "string", format: "date-time" },
    payload: { type: "object", additionalProperties: true },
    statistics: {
      type: "object",
      additionalProperties: false,
      required: ["attemptCount", "averageDurationMs", "averageScore"],
      properties: {
        attemptCount: { type: "integer", minimum: 20 },
        averageDurationMs: { type: "integer", minimum: 0 },
        averageScore: { type: "integer", minimum: 0 },
        observedDifficulty: { type: "number", minimum: 1, maximum: 5 },
        difficultyConfidence: { type: "number", minimum: 0, maximum: 1 },
        crosswordEntries: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["entryId", "incorrectPercent"],
            properties: {
              entryId: { type: "string" },
              incorrectPercent: { type: "integer", minimum: 0, maximum: 100 },
            },
          },
        },
        quizQuestions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["correctPercent", "questionId"],
            properties: {
              correctPercent: { type: "integer", minimum: 0, maximum: 100 },
              questionId: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

export interface QuizPublicSolutionPayload {
  readonly kind: "quiz-solution";
  readonly questions: readonly {
    readonly questionId: string;
    readonly correctOptionId: string;
    readonly explanation: string;
  }[];
}

export interface CrosswordPublicSolutionPayload {
  readonly kind: "crossword-solution";
  readonly entries: readonly { readonly entryId: string; readonly answer: string }[];
}

export interface GuessWordPublicPayload {
  readonly allowedCharacters: readonly string[];
  readonly category: string;
  readonly definition: string;
  readonly difficulty: 1 | 2 | 3 | 4 | 5;
  readonly hints: readonly { readonly text: string; readonly unlockAfterAttempts: number }[];
  readonly id: string;
  readonly kind: "guess-word";
  readonly maxAttempts: number;
  readonly title: string;
}

export interface GuessWordPublicSolutionPayload {
  readonly answer: string;
  readonly kind: "guess-word-solution";
}

export interface WordSearchPublicPayload {
  readonly columns: number;
  readonly difficulty?: 1 | 2 | 3 | 4 | 5;
  readonly grid: readonly (readonly string[])[];
  readonly kind: "word-search";
  readonly rows: number;
  readonly seed: string;
  readonly title: string;
  readonly words: readonly { readonly answer: string; readonly id: string }[];
}

export interface WordSearchPublicSolutionPayload {
  readonly entries: readonly {
    readonly answer: string;
    readonly column: number;
    readonly direction: string;
    readonly row: number;
  }[];
  readonly kind: "word-search-solution";
}

export interface GuestSessionCredential {
  readonly expiresAt: string;
  readonly guestSessionId: string;
  readonly token: string;
}

export const guestSessionCredentialSchema = {
  type: "object",
  additionalProperties: false,
  required: ["guestSessionId", "token", "expiresAt"],
  properties: {
    guestSessionId: { type: "string", format: "uuid" },
    token: { type: "string", minLength: 43, maxLength: 64 },
    expiresAt: { type: "string", format: "date-time" },
  },
} as const;

export type QuizDifficulty = "very_easy" | "easy" | "medium" | "hard" | "expert";

export interface QuizOptionPublic {
  readonly id: string;
  readonly text: string;
}

export interface QuizQuestionPublic {
  readonly id: string;
  readonly prompt: string;
  readonly category: string;
  readonly difficulty: QuizDifficulty;
  readonly options: readonly QuizOptionPublic[];
}

export interface QuizPublicPayload {
  readonly kind: "quiz";
  readonly title: string;
  readonly questions: readonly QuizQuestionPublic[];
}

export const quizPublicPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "title", "questions"],
  properties: {
    kind: { const: "quiz" },
    title: { type: "string", minLength: 1, maxLength: 120 },
    questions: {
      type: "array",
      minItems: 5,
      maxItems: 15,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "prompt", "category", "difficulty", "options"],
        properties: {
          id: { type: "string", format: "uuid" },
          prompt: { type: "string", minLength: 1, maxLength: 280 },
          category: { type: "string", minLength: 1, maxLength: 80 },
          difficulty: { enum: ["very_easy", "easy", "medium", "hard", "expert"] },
          options: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "text"],
              properties: {
                id: { type: "string", format: "uuid" },
                text: { type: "string", minLength: 1, maxLength: 160 },
              },
            },
          },
        },
      },
    },
  },
} as const;

export interface QuizAttemptAnswer {
  readonly elapsedMs: number;
  readonly questionId: string;
  readonly selectedOptionId: string;
}

export interface QuizAttemptState {
  readonly answers: readonly QuizAttemptAnswer[];
  readonly attemptId: string;
  readonly result?: QuizSubmitResult;
  readonly status: "in_progress" | "accepted";
  readonly version: number;
}

export interface QuizProgressEvent extends QuizAttemptAnswer {
  readonly clientEventId: string;
  readonly clientOccurredAt?: string;
}

export interface QuizProgressSaved {
  readonly savedEvents: number;
  readonly status: "saved";
  readonly version: number;
}

export interface QuizProgressConflict {
  readonly code: "VERSION_CONFLICT";
  readonly state: QuizAttemptState;
}

export type QuizProgressResponse = QuizProgressSaved | QuizProgressConflict;

export interface QuizLocalDraft {
  readonly attempt: QuizAttemptState;
  readonly contentVersion: number;
  readonly current: number;
  readonly gameType?: "quiz" | "true_false";
  readonly gameId: string;
  readonly pendingEvents: readonly QuizProgressEvent[];
  readonly quiz: QuizPublicPayload;
  readonly savedAt: string;
}

export interface QuizSubmitResult {
  readonly attemptId: string;
  readonly competitive: boolean;
  readonly provisional: {
    readonly completed: boolean;
    readonly score: number;
  };
  readonly solutionAvailableAt: string;
  readonly status: "accepted";
}

export interface GuessWordAttempt {
  readonly elapsedMs: number;
  readonly guess: string;
}

export interface GuessWordAttemptState {
  readonly attemptId: string;
  readonly guesses: readonly GuessWordAttempt[];
  readonly result?: QuizSubmitResult;
  readonly status: "in_progress" | "accepted";
  readonly version: number;
}

export interface GuessWordGuessEvent {
  readonly clientEventId: string;
  readonly clientOccurredAt?: string;
  readonly elapsedMs: number;
  readonly guess: string;
  readonly version: number;
}

export interface GuessWordGuessResult {
  readonly attempt: GuessWordAttemptState;
  readonly outcome: "correct" | "incorrect" | "exhausted";
}

export interface WordSearchFoundEntry {
  readonly elapsedMs: number;
  readonly entryId: string;
}

export interface WordSearchAttemptState {
  readonly attemptId: string;
  readonly foundEntries: readonly WordSearchFoundEntry[];
  readonly result?: QuizSubmitResult;
  readonly status: "in_progress" | "accepted";
  readonly version: number;
}

export interface WordSearchSelectionEvent {
  readonly clientEventId: string;
  readonly clientOccurredAt?: string;
  readonly elapsedMs: number;
  readonly endColumn: number;
  readonly endRow: number;
  readonly entryId: string;
  readonly startColumn: number;
  readonly startRow: number;
  readonly version: number;
}

export interface WordSearchSelectionResult {
  readonly attempt: WordSearchAttemptState;
  readonly outcome: "found" | "incorrect" | "already_found";
}

export type CrosswordDirection = "across" | "down";

export interface CrosswordCoordinate {
  readonly row: number;
  readonly column: number;
}

export interface CrosswordCellPublic extends CrosswordCoordinate {
  readonly id: string;
  readonly number?: number;
}

export interface CrosswordEntryPublic {
  readonly id: string;
  readonly number: number;
  readonly direction: CrosswordDirection;
  readonly clue: string;
  readonly cellIds: readonly string[];
}

export interface CrosswordPublicPayload {
  readonly kind: "crossword";
  readonly title: string;
  readonly difficulty?: 1 | 2 | 3 | 4 | 5;
  readonly rows: number;
  readonly columns: number;
  readonly cells: readonly CrosswordCellPublic[];
  readonly blocks: readonly CrosswordCoordinate[];
  readonly entries: readonly CrosswordEntryPublic[];
  readonly rules: { readonly accentPolicy: "fold" };
}

export interface CrosswordAttemptCell {
  readonly cellId: string;
  readonly value: string;
  readonly elapsedMs: number;
}

export interface CrosswordAttemptState {
  readonly attemptId: string;
  readonly cells: readonly CrosswordAttemptCell[];
  readonly hintsUsed: number;
  readonly result?: CrosswordSubmitResult;
  readonly status: "in_progress" | "accepted";
  readonly version: number;
}

export interface CrosswordProgressEvent extends CrosswordAttemptCell {
  readonly clientEventId: string;
  readonly clientOccurredAt?: string;
}

export type CrosswordProgressSaved = QuizProgressSaved;

export interface CrosswordProgressConflict {
  readonly code: "VERSION_CONFLICT";
  readonly state: CrosswordAttemptState;
}

export type CrosswordProgressResponse = CrosswordProgressSaved | CrosswordProgressConflict;

export interface CrosswordLocalDraft {
  readonly activeCellId: string;
  readonly activeEntryId: string;
  readonly attempt: CrosswordAttemptState;
  readonly contentVersion: number;
  readonly crossword: CrosswordPublicPayload;
  readonly gameId: string;
  readonly pendingEvents: readonly CrosswordProgressEvent[];
  readonly savedAt: string;
}

export interface CrosswordSubmitResult {
  readonly attemptId: string;
  readonly competitive: boolean;
  readonly provisional: {
    readonly completed: boolean;
    readonly score: number;
  };
  readonly solutionAvailableAt: string;
  readonly status: "accepted";
}

export interface CrosswordHintResult {
  readonly attemptId: string;
  readonly cellId: string;
  readonly competitive: false;
  readonly hintsUsed: number;
  readonly value: string;
  readonly version: number;
}

export type AttemptReviewProgress =
  | {
      readonly kind: "quiz-progress";
      readonly answers: readonly QuizAttemptAnswer[];
    }
  | {
      readonly kind: "crossword-progress";
      readonly cells: readonly CrosswordAttemptCell[];
      readonly hintsUsed: number;
    }
  | {
      readonly guesses: readonly GuessWordAttempt[];
      readonly kind: "guess-word-progress";
    }
  | {
      readonly foundEntries: readonly WordSearchFoundEntry[];
      readonly kind: "word-search-progress";
    };

export interface AttemptReview {
  readonly attemptId: string;
  readonly progress: AttemptReviewProgress;
  readonly score: {
    readonly competitive: boolean;
    readonly points: number;
    readonly scoreVersion: string;
  };
  readonly solution: PublicSolution;
  readonly submittedAt: string;
}

export interface LeaderboardEntry {
  readonly alias: string;
  readonly durationMs: number;
  readonly points: number;
  readonly rank: number;
}

export interface LeaderboardPosition {
  readonly durationMs: number;
  readonly percentile: number;
  readonly points: number;
  readonly rank: number;
  readonly total: number;
}

export interface Leaderboard {
  readonly entries: readonly LeaderboardEntry[];
  readonly key: string;
  readonly own?: LeaderboardPosition;
  readonly scope: "daily" | "game" | "weekly";
}

export interface StreakSummary {
  readonly best: number;
  readonly current: number;
  readonly lastCompletedDate: string | null;
}

export interface PlayerProgression {
  readonly achievements: readonly {
    readonly earnedAt: string;
    readonly key: "daily-double" | "first-game";
  }[];
  readonly experience: number;
  readonly level: number;
  readonly nextLevelExperience: number;
  readonly version: "xp-v1";
}

export const playerProgressionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["achievements", "experience", "level", "nextLevelExperience", "version"],
  properties: {
    achievements: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["earnedAt", "key"],
        properties: {
          earnedAt: { type: "string", format: "date-time" },
          key: { enum: ["first-game", "daily-double"] },
        },
      },
    },
    experience: { type: "integer", minimum: 0 },
    level: { type: "integer", minimum: 1 },
    nextLevelExperience: { type: "integer", minimum: 100 },
    version: { const: "xp-v1" },
  },
} as const;

export interface PreviousResultSummary {
  readonly attemptId: string;
  readonly competitive: boolean;
  readonly gameId: string;
  readonly gameType: "crossword" | "quiz" | "true_false" | "guess_word" | "word_search";
  readonly localDate: string;
  readonly points: number;
  readonly rank?: number;
  readonly total?: number;
}

export interface AccountDataExport {
  readonly analyticsEvents: readonly {
    readonly eventName: AnalyticsEventName;
    readonly occurredAt: string;
    readonly properties: Readonly<Record<string, boolean | number | string>>;
  }[];
  readonly attempts: readonly {
    readonly competitive: boolean | null;
    readonly gameType: "crossword" | "quiz" | "true_false" | "guess_word" | "word_search";
    readonly id: string;
    readonly localDate: string;
    readonly mode: "casual" | "competitive";
    readonly points: number | null;
    readonly startedAt: string;
    readonly status: string;
    readonly submittedAt: string | null;
  }[];
  readonly crosswordCells: readonly {
    readonly attemptId: string;
    readonly cellId: string;
    readonly elapsedMs: number;
    readonly value: string;
  }[];
  readonly consents: readonly {
    readonly ads: boolean;
    readonly analytics: boolean;
    readonly policyVersion: string;
    readonly recordedAt: string;
    readonly source: "android" | "ios" | "web";
  }[];
  readonly generatedAt: string;
  readonly notificationPreferences: NotificationPreferences | null;
  readonly profile: {
    readonly alias: string | null;
    readonly createdAt: string;
    readonly email: string;
    readonly leaderboardOptIn: boolean;
  };
  readonly quizAnswers: readonly {
    readonly attemptId: string;
    readonly elapsedMs: number;
    readonly questionId: string;
    readonly selectedOptionId: string;
  }[];
  readonly wordGuesses: readonly {
    readonly attemptId: string;
    readonly elapsedMs: number;
    readonly guess: string;
  }[];
  readonly wordSearchFinds: readonly (WordSearchFoundEntry & { readonly attemptId: string })[];
}

export interface UserLeaderboardSettings {
  readonly alias: string | null;
  readonly leaderboardOptIn: boolean;
}

export interface ShareResult {
  readonly text: string;
  readonly url: string;
}

export interface ConsentState {
  readonly ads: boolean;
  readonly analytics: boolean;
  readonly policyVersion: string;
  readonly recordedAt: string | null;
}

export const currentConsentPolicyVersion = "2026-07-01";

export const analyticsEventNames = [
  "AppOpened",
  "DailyEditionViewed",
  "GameStarted",
  "GameCompleted",
  "ResultViewed",
  "ShareCompleted",
  "RegistrationCompleted",
  "LoginCompleted",
] as const;

export type AnalyticsEventName = (typeof analyticsEventNames)[number];

export interface AnalyticsEventInput {
  readonly eventId: string;
  readonly eventName: AnalyticsEventName;
  readonly occurredAt: string;
  readonly properties: Readonly<Record<string, boolean | number | string>>;
  readonly schemaVersion: 1;
}

export interface AnalyticsIngestResult {
  readonly accepted: number;
}

export interface NotificationPreferences {
  readonly editionAvailable: boolean;
  readonly enabled: boolean;
  readonly previousSolution: boolean;
  readonly quietEnd: string;
  readonly quietStart: string;
  readonly timeZone: string;
}

export const crosswordPublicPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "title", "rows", "columns", "cells", "blocks", "entries", "rules"],
  properties: {
    kind: { const: "crossword" },
    title: { type: "string", minLength: 1, maxLength: 120 },
    difficulty: { type: "integer", minimum: 1, maximum: 5 },
    rows: { type: "integer", minimum: 3, maximum: 21 },
    columns: { type: "integer", minimum: 3, maximum: 21 },
    cells: {
      type: "array",
      minItems: 2,
      maxItems: 441,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "row", "column"],
        properties: {
          id: { type: "string", format: "uuid" },
          row: { type: "integer", minimum: 0, maximum: 20 },
          column: { type: "integer", minimum: 0, maximum: 20 },
          number: { type: "integer", minimum: 1, maximum: 441 },
        },
      },
    },
    blocks: {
      type: "array",
      maxItems: 439,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["row", "column"],
        properties: {
          row: { type: "integer", minimum: 0, maximum: 20 },
          column: { type: "integer", minimum: 0, maximum: 20 },
        },
      },
    },
    entries: {
      type: "array",
      minItems: 2,
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "number", "direction", "clue", "cellIds"],
        properties: {
          id: { type: "string", format: "uuid" },
          number: { type: "integer", minimum: 1, maximum: 441 },
          direction: { enum: ["across", "down"] },
          clue: { type: "string", minLength: 1, maxLength: 280 },
          cellIds: {
            type: "array",
            minItems: 2,
            maxItems: 21,
            items: { type: "string", format: "uuid" },
          },
        },
      },
    },
    rules: {
      type: "object",
      additionalProperties: false,
      required: ["accentPolicy"],
      properties: { accentPolicy: { const: "fold" } },
    },
  },
} as const;

export const crosswordSubmitResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attemptId", "status", "competitive", "provisional", "solutionAvailableAt"],
  properties: {
    attemptId: { type: "string", format: "uuid" },
    status: { const: "accepted" },
    competitive: { type: "boolean" },
    provisional: {
      type: "object",
      additionalProperties: false,
      required: ["score", "completed"],
      properties: { score: { type: "integer", minimum: 0 }, completed: { type: "boolean" } },
    },
    solutionAvailableAt: { type: "string", format: "date-time" },
  },
} as const;

export const crosswordAttemptStateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attemptId", "status", "version", "cells", "hintsUsed"],
  properties: {
    attemptId: { type: "string", format: "uuid" },
    status: { enum: ["in_progress", "accepted"] },
    version: { type: "integer", minimum: 1 },
    hintsUsed: { type: "integer", minimum: 0 },
    cells: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cellId", "value", "elapsedMs"],
        properties: {
          cellId: { type: "string", format: "uuid" },
          value: { type: "string", minLength: 0, maxLength: 2 },
          elapsedMs: { type: "integer", minimum: 0, maximum: 3_600_000 },
        },
      },
    },
    result: crosswordSubmitResultSchema,
  },
} as const;

export const crosswordHintResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attemptId", "cellId", "value", "hintsUsed", "competitive", "version"],
  properties: {
    attemptId: { type: "string", format: "uuid" },
    cellId: { type: "string", format: "uuid" },
    value: { type: "string", minLength: 1, maxLength: 2 },
    hintsUsed: { type: "integer", minimum: 1 },
    competitive: { const: false },
    version: { type: "integer", minimum: 1 },
  },
} as const;

export const quizSubmitResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attemptId", "status", "competitive", "provisional", "solutionAvailableAt"],
  properties: {
    attemptId: { type: "string", format: "uuid" },
    status: { const: "accepted" },
    competitive: { type: "boolean" },
    provisional: {
      type: "object",
      additionalProperties: false,
      required: ["score", "completed"],
      properties: { score: { type: "integer", minimum: 0 }, completed: { type: "boolean" } },
    },
    solutionAvailableAt: { type: "string", format: "date-time" },
  },
} as const;

export const quizAttemptStateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attemptId", "status", "version", "answers"],
  properties: {
    attemptId: { type: "string", format: "uuid" },
    status: { enum: ["in_progress", "accepted"] },
    version: { type: "integer", minimum: 1 },
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["questionId", "selectedOptionId", "elapsedMs"],
        properties: {
          questionId: { type: "string", format: "uuid" },
          selectedOptionId: { type: "string", format: "uuid" },
          elapsedMs: { type: "integer", minimum: 0, maximum: 3_600_000 },
        },
      },
    },
    result: quizSubmitResultSchema,
  },
} as const;

export const guessWordAttemptStateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attemptId", "status", "version", "guesses"],
  properties: {
    attemptId: { type: "string", format: "uuid" },
    status: { enum: ["in_progress", "accepted"] },
    version: { type: "integer", minimum: 1 },
    guesses: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["guess", "elapsedMs"],
        properties: {
          guess: { type: "string", minLength: 1, maxLength: 21 },
          elapsedMs: { type: "integer", minimum: 0, maximum: 3_600_000 },
        },
      },
    },
    result: quizSubmitResultSchema,
  },
} as const;

export const guessWordGuessResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attempt", "outcome"],
  properties: {
    attempt: guessWordAttemptStateSchema,
    outcome: { enum: ["correct", "incorrect", "exhausted"] },
  },
} as const;

export const wordSearchAttemptStateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attemptId", "status", "version", "foundEntries"],
  properties: {
    attemptId: { type: "string", format: "uuid" },
    status: { enum: ["in_progress", "accepted"] },
    version: { type: "integer", minimum: 1 },
    foundEntries: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["entryId", "elapsedMs"],
        properties: {
          entryId: { type: "string", format: "uuid" },
          elapsedMs: { type: "integer", minimum: 0, maximum: 3_600_000 },
        },
      },
    },
    result: quizSubmitResultSchema,
  },
} as const;

export const wordSearchSelectionEventSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "clientEventId",
    "elapsedMs",
    "endColumn",
    "endRow",
    "entryId",
    "startColumn",
    "startRow",
    "version",
  ],
  properties: {
    clientEventId: { type: "string", format: "uuid" },
    clientOccurredAt: { type: "string", format: "date-time" },
    elapsedMs: { type: "integer", minimum: 0, maximum: 3_600_000 },
    endColumn: { type: "integer", minimum: 0, maximum: 20 },
    endRow: { type: "integer", minimum: 0, maximum: 20 },
    entryId: { type: "string", format: "uuid" },
    startColumn: { type: "integer", minimum: 0, maximum: 20 },
    startRow: { type: "integer", minimum: 0, maximum: 20 },
    version: { type: "integer", minimum: 1 },
  },
} as const;

export const wordSearchSelectionResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attempt", "outcome"],
  properties: {
    attempt: wordSearchAttemptStateSchema,
    outcome: { enum: ["found", "incorrect", "already_found"] },
  },
} as const;

export const attemptReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["attemptId", "progress", "score", "solution", "submittedAt"],
  properties: {
    attemptId: { type: "string", format: "uuid" },
    progress: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "answers"],
          properties: {
            kind: { const: "quiz-progress" },
            answers: quizAttemptStateSchema.properties.answers,
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "guesses"],
          properties: {
            kind: { const: "guess-word-progress" },
            guesses: guessWordAttemptStateSchema.properties.guesses,
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "foundEntries"],
          properties: {
            kind: { const: "word-search-progress" },
            foundEntries: wordSearchAttemptStateSchema.properties.foundEntries,
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "cells", "hintsUsed"],
          properties: {
            kind: { const: "crossword-progress" },
            cells: crosswordAttemptStateSchema.properties.cells,
            hintsUsed: { type: "integer", minimum: 0 },
          },
        },
      ],
    },
    score: {
      type: "object",
      additionalProperties: false,
      required: ["competitive", "points", "scoreVersion"],
      properties: {
        competitive: { type: "boolean" },
        points: { type: "integer", minimum: 0 },
        scoreVersion: { type: "string", minLength: 1 },
      },
    },
    solution: publicSolutionSchema,
    submittedAt: { type: "string", format: "date-time" },
  },
} as const;

const leaderboardEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["alias", "durationMs", "points", "rank"],
  properties: {
    alias: { type: "string", minLength: 3, maxLength: 24 },
    durationMs: { type: "integer", minimum: 0 },
    points: { type: "integer", minimum: 0 },
    rank: { type: "integer", minimum: 1 },
  },
} as const;

export const leaderboardSchema = {
  type: "object",
  additionalProperties: false,
  required: ["entries", "key", "scope"],
  properties: {
    entries: { type: "array", maxItems: 100, items: leaderboardEntrySchema },
    key: { type: "string", minLength: 1, maxLength: 64 },
    own: {
      type: "object",
      additionalProperties: false,
      required: ["durationMs", "percentile", "points", "rank", "total"],
      properties: {
        durationMs: { type: "integer", minimum: 0 },
        percentile: { type: "integer", minimum: 1, maximum: 100 },
        points: { type: "integer", minimum: 0 },
        rank: { type: "integer", minimum: 1 },
        total: { type: "integer", minimum: 1 },
      },
    },
    scope: { enum: ["daily", "game", "weekly"] },
  },
} as const;

export const streakSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["best", "current", "lastCompletedDate"],
  properties: {
    best: { type: "integer", minimum: 0 },
    current: { type: "integer", minimum: 0 },
    lastCompletedDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
  },
} as const;

export const previousResultSummariesSchema = {
  type: "array",
  maxItems: 2,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["attemptId", "competitive", "gameId", "gameType", "localDate", "points"],
    properties: {
      attemptId: { type: "string", format: "uuid" },
      competitive: { type: "boolean" },
      gameId: { type: "string", format: "uuid" },
      gameType: { enum: ["crossword", "quiz", "true_false", "guess_word", "word_search"] },
      localDate: { type: "string", format: "date" },
      points: { type: "integer", minimum: 0 },
      rank: { type: "integer", minimum: 1 },
      total: { type: "integer", minimum: 1 },
    },
  },
} as const;

export const accountDataExportSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "analyticsEvents",
    "attempts",
    "consents",
    "crosswordCells",
    "generatedAt",
    "notificationPreferences",
    "profile",
    "quizAnswers",
    "wordGuesses",
    "wordSearchFinds",
  ],
  properties: {
    analyticsEvents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["eventName", "occurredAt", "properties"],
        properties: {
          eventName: { enum: analyticsEventNames },
          occurredAt: { type: "string", format: "date-time" },
          properties: { type: "object", additionalProperties: true },
        },
      },
    },
    attempts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "competitive",
          "gameType",
          "id",
          "localDate",
          "mode",
          "points",
          "startedAt",
          "status",
          "submittedAt",
        ],
        properties: {
          competitive: { anyOf: [{ type: "boolean" }, { type: "null" }] },
          gameType: { enum: ["crossword", "quiz", "true_false", "guess_word", "word_search"] },
          id: { type: "string", format: "uuid" },
          localDate: { type: "string", format: "date" },
          mode: { enum: ["casual", "competitive"] },
          points: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
          startedAt: { type: "string", format: "date-time" },
          status: { type: "string" },
          submittedAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
        },
      },
    },
    consents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ads", "analytics", "policyVersion", "recordedAt", "source"],
        properties: {
          ads: { type: "boolean" },
          analytics: { type: "boolean" },
          policyVersion: { type: "string" },
          recordedAt: { type: "string", format: "date-time" },
          source: { enum: ["android", "ios", "web"] },
        },
      },
    },
    crosswordCells: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["attemptId", "cellId", "elapsedMs", "value"],
        properties: {
          attemptId: { type: "string", format: "uuid" },
          cellId: { type: "string", format: "uuid" },
          elapsedMs: { type: "integer", minimum: 0 },
          value: { type: "string", minLength: 1, maxLength: 2 },
        },
      },
    },
    generatedAt: { type: "string", format: "date-time" },
    notificationPreferences: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: [
            "editionAvailable",
            "enabled",
            "previousSolution",
            "quietEnd",
            "quietStart",
            "timeZone",
          ],
          properties: {
            editionAvailable: { type: "boolean" },
            enabled: { type: "boolean" },
            previousSolution: { type: "boolean" },
            quietEnd: { type: "string" },
            quietStart: { type: "string" },
            timeZone: { type: "string" },
          },
        },
        { type: "null" },
      ],
    },
    profile: {
      type: "object",
      additionalProperties: false,
      required: ["alias", "createdAt", "email", "leaderboardOptIn"],
      properties: {
        alias: { anyOf: [{ type: "string" }, { type: "null" }] },
        createdAt: { type: "string", format: "date-time" },
        email: { type: "string", format: "email" },
        leaderboardOptIn: { type: "boolean" },
      },
    },
    quizAnswers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["attemptId", "elapsedMs", "questionId", "selectedOptionId"],
        properties: {
          attemptId: { type: "string", format: "uuid" },
          elapsedMs: { type: "integer", minimum: 0 },
          questionId: { type: "string", format: "uuid" },
          selectedOptionId: { type: "string", format: "uuid" },
        },
      },
    },
    wordGuesses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["attemptId", "elapsedMs", "guess"],
        properties: {
          attemptId: { type: "string", format: "uuid" },
          elapsedMs: { type: "integer", minimum: 0, maximum: 3_600_000 },
          guess: { type: "string", minLength: 1, maxLength: 21 },
        },
      },
    },
    wordSearchFinds: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["attemptId", "entryId", "elapsedMs"],
        properties: {
          attemptId: { type: "string", format: "uuid" },
          entryId: { type: "string", format: "uuid" },
          elapsedMs: { type: "integer", minimum: 0, maximum: 3_600_000 },
        },
      },
    },
  },
} as const;

export const accountDeletionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["deleted"],
  properties: { deleted: { const: true } },
} as const;

export const userLeaderboardSettingsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["alias", "leaderboardOptIn"],
  properties: {
    alias: { anyOf: [{ type: "string", minLength: 3, maxLength: 24 }, { type: "null" }] },
    leaderboardOptIn: { type: "boolean" },
  },
} as const;

export const shareResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "url"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 280 },
    url: { type: "string", format: "uri" },
  },
} as const;

export const consentStateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ads", "analytics", "policyVersion", "recordedAt"],
  properties: {
    ads: { type: "boolean" },
    analytics: { type: "boolean" },
    policyVersion: { type: "string", minLength: 1, maxLength: 40 },
    recordedAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
  },
} as const;

export const analyticsEventsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["eventId", "eventName", "occurredAt", "properties", "schemaVersion"],
        properties: {
          eventId: { type: "string", format: "uuid" },
          eventName: { enum: analyticsEventNames },
          occurredAt: { type: "string", format: "date-time" },
          properties: {
            type: "object",
            maxProperties: 12,
            additionalProperties: { type: ["boolean", "number", "string"] },
          },
          schemaVersion: { const: 1 },
        },
      },
    },
  },
} as const;

export const analyticsIngestResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["accepted"],
  properties: { accepted: { type: "integer", minimum: 0, maximum: 100 } },
} as const;

export const notificationPreferencesSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "editionAvailable",
    "enabled",
    "previousSolution",
    "quietEnd",
    "quietStart",
    "timeZone",
  ],
  properties: {
    editionAvailable: { type: "boolean" },
    enabled: { type: "boolean" },
    previousSolution: { type: "boolean" },
    quietEnd: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" },
    quietStart: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" },
    timeZone: { type: "string", minLength: 1, maxLength: 64 },
  },
} as const;

export function isPublicQuizGame(
  value: unknown,
): value is PublicGame & { payload: QuizPublicPayload } {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.type === "quiz" &&
    (value.status === "active" || value.status === "disabled") &&
    Number.isInteger(value.contentVersion) &&
    isQuizPublicPayload(value.payload)
  );
}

export function isPublicQuizStyleGame(
  value: unknown,
): value is PublicGame & { payload: QuizPublicPayload } {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.type === "quiz" || value.type === "true_false") &&
    (value.status === "active" || value.status === "disabled") &&
    Number.isInteger(value.contentVersion) &&
    (value.type === "quiz"
      ? isQuizPublicPayload(value.payload)
      : isTrueFalseQuizPayload(value.payload))
  );
}

export function isPublicGuessWordGame(
  value: unknown,
): value is PublicGame & { payload: GuessWordPublicPayload } {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.type === "guess_word" &&
    (value.status === "active" || value.status === "disabled") &&
    Number.isInteger(value.contentVersion) &&
    isGuessWordPublicPayload(value.payload)
  );
}

export function isPublicWordSearchGame(
  value: unknown,
): value is PublicGame & { payload: WordSearchPublicPayload } {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.type === "word_search" &&
    (value.status === "active" || value.status === "disabled") &&
    Number.isInteger(value.contentVersion) &&
    isWordSearchPublicPayload(value.payload)
  );
}

export function isWordSearchPublicPayload(value: unknown): value is WordSearchPublicPayload {
  return (
    isRecord(value) &&
    value.kind === "word-search" &&
    typeof value.title === "string" &&
    (value.difficulty === undefined ||
      (Number.isInteger(value.difficulty) &&
        Number(value.difficulty) >= 1 &&
        Number(value.difficulty) <= 5)) &&
    typeof value.seed === "string" &&
    Number.isInteger(value.rows) &&
    Number(value.rows) >= 4 &&
    Number(value.rows) <= 21 &&
    Number.isInteger(value.columns) &&
    Number(value.columns) >= 4 &&
    Number(value.columns) <= 21 &&
    Array.isArray(value.grid) &&
    value.grid.length === value.rows &&
    value.grid.every(
      (row) =>
        Array.isArray(row) &&
        row.length === value.columns &&
        row.every((letter) => typeof letter === "string"),
    ) &&
    Array.isArray(value.words) &&
    value.words.length >= 3 &&
    value.words.every(
      (word) => isRecord(word) && typeof word.id === "string" && typeof word.answer === "string",
    )
  );
}

export function isWordSearchPublicSolutionPayload(
  value: unknown,
): value is WordSearchPublicSolutionPayload {
  return (
    isRecord(value) &&
    value.kind === "word-search-solution" &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.answer === "string" &&
        typeof entry.direction === "string" &&
        Number.isInteger(entry.row) &&
        Number.isInteger(entry.column),
    )
  );
}

export function isGuessWordPublicPayload(value: unknown): value is GuessWordPublicPayload {
  if (
    !isRecord(value) ||
    value.kind !== "guess-word" ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.definition !== "string" ||
    typeof value.category !== "string" ||
    ![1, 2, 3, 4, 5].includes(Number(value.difficulty)) ||
    !Number.isInteger(value.maxAttempts) ||
    Number(value.maxAttempts) < 1 ||
    Number(value.maxAttempts) > 12 ||
    !Array.isArray(value.allowedCharacters) ||
    value.allowedCharacters.length === 0 ||
    !value.allowedCharacters.every((character) => typeof character === "string") ||
    !Array.isArray(value.hints)
  ) {
    return false;
  }
  return value.hints.every(
    (hint) =>
      isRecord(hint) &&
      typeof hint.text === "string" &&
      Number.isInteger(hint.unlockAfterAttempts) &&
      Number(hint.unlockAfterAttempts) >= 0 &&
      Number(hint.unlockAfterAttempts) <= Number(value.maxAttempts),
  );
}

export function isGuessWordPublicSolutionPayload(
  value: unknown,
): value is GuessWordPublicSolutionPayload {
  return (
    isRecord(value) &&
    value.kind === "guess-word-solution" &&
    typeof value.answer === "string" &&
    value.answer.length >= 3 &&
    value.answer.length <= 21
  );
}

function isTrueFalseQuizPayload(value: unknown): value is QuizPublicPayload {
  if (!isRecord(value) || value.kind !== "quiz" || typeof value.title !== "string") return false;
  if (!Array.isArray(value.questions) || value.questions.length < 3 || value.questions.length > 20)
    return false;
  return value.questions.every(
    (question) =>
      isRecord(question) &&
      typeof question.id === "string" &&
      typeof question.prompt === "string" &&
      typeof question.category === "string" &&
      ["very_easy", "easy", "medium", "hard", "expert"].includes(String(question.difficulty)) &&
      Array.isArray(question.options) &&
      question.options.length === 2 &&
      question.options.every(
        (option) =>
          isRecord(option) && typeof option.id === "string" && typeof option.text === "string",
      ),
  );
}

export function isQuizPublicPayload(value: unknown): value is QuizPublicPayload {
  if (!isRecord(value) || value.kind !== "quiz" || typeof value.title !== "string") return false;
  if (!Array.isArray(value.questions) || value.questions.length < 5 || value.questions.length > 15)
    return false;
  return value.questions.every(
    (question) =>
      isRecord(question) &&
      typeof question.id === "string" &&
      typeof question.prompt === "string" &&
      typeof question.category === "string" &&
      ["very_easy", "easy", "medium", "hard", "expert"].includes(String(question.difficulty)) &&
      Array.isArray(question.options) &&
      question.options.length === 4 &&
      question.options.every(
        (option) =>
          isRecord(option) && typeof option.id === "string" && typeof option.text === "string",
      ),
  );
}

export function isQuizPublicSolutionPayload(value: unknown): value is QuizPublicSolutionPayload {
  return (
    isRecord(value) &&
    value.kind === "quiz-solution" &&
    Array.isArray(value.questions) &&
    value.questions.every(
      (question) =>
        isRecord(question) &&
        typeof question.questionId === "string" &&
        typeof question.correctOptionId === "string" &&
        typeof question.explanation === "string" &&
        question.explanation.length > 0,
    )
  );
}

export function isQuizAttemptState(value: unknown): value is QuizAttemptState {
  if (!isRecord(value)) return false;
  return (
    typeof value.attemptId === "string" &&
    (value.status === "in_progress" || value.status === "accepted") &&
    Number.isInteger(value.version) &&
    Number(value.version) >= 1 &&
    Array.isArray(value.answers) &&
    value.answers.every(isQuizAttemptAnswer) &&
    (value.result === undefined || isQuizSubmitResult(value.result))
  );
}

export function isGuessWordAttemptState(value: unknown): value is GuessWordAttemptState {
  return (
    isRecord(value) &&
    typeof value.attemptId === "string" &&
    (value.status === "in_progress" || value.status === "accepted") &&
    Number.isInteger(value.version) &&
    Number(value.version) >= 1 &&
    Array.isArray(value.guesses) &&
    value.guesses.every(isGuessWordAttempt) &&
    (value.result === undefined || isQuizSubmitResult(value.result))
  );
}

export function isWordSearchAttemptState(value: unknown): value is WordSearchAttemptState {
  return (
    isRecord(value) &&
    typeof value.attemptId === "string" &&
    (value.status === "in_progress" || value.status === "accepted") &&
    Number.isInteger(value.version) &&
    Array.isArray(value.foundEntries) &&
    value.foundEntries.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.entryId === "string" &&
        Number.isInteger(entry.elapsedMs) &&
        Number(entry.elapsedMs) >= 0,
    ) &&
    (value.result === undefined || isQuizSubmitResult(value.result))
  );
}

function isWordSearchFoundEntry(value: unknown): value is WordSearchFoundEntry {
  return (
    isRecord(value) &&
    typeof value.entryId === "string" &&
    Number.isInteger(value.elapsedMs) &&
    Number(value.elapsedMs) >= 0 &&
    Number(value.elapsedMs) <= 3_600_000
  );
}

export function isWordSearchSelectionResult(value: unknown): value is WordSearchSelectionResult {
  return (
    isRecord(value) &&
    (value.outcome === "found" ||
      value.outcome === "incorrect" ||
      value.outcome === "already_found") &&
    isWordSearchAttemptState(value.attempt)
  );
}

export function isGuessWordGuessResult(value: unknown): value is GuessWordGuessResult {
  return (
    isRecord(value) &&
    (value.outcome === "correct" ||
      value.outcome === "incorrect" ||
      value.outcome === "exhausted") &&
    isGuessWordAttemptState(value.attempt)
  );
}

export function isQuizLocalDraft(value: unknown, gameId: string): value is QuizLocalDraft {
  if (!isRecord(value)) return false;
  return (
    value.gameId === gameId &&
    (value.gameType === undefined ||
      value.gameType === "quiz" ||
      value.gameType === "true_false") &&
    Number.isInteger(value.contentVersion) &&
    Number(value.contentVersion) >= 1 &&
    Number.isInteger(value.current) &&
    Number(value.current) >= 0 &&
    typeof value.savedAt === "string" &&
    isQuizPublicPayload(value.quiz) &&
    isQuizAttemptState(value.attempt) &&
    Array.isArray(value.pendingEvents) &&
    value.pendingEvents.every(isQuizProgressEvent)
  );
}

function isQuizAttemptAnswer(value: unknown): value is QuizAttemptAnswer {
  if (!isRecord(value)) return false;
  return (
    typeof value.questionId === "string" &&
    typeof value.selectedOptionId === "string" &&
    Number.isInteger(value.elapsedMs) &&
    Number(value.elapsedMs) >= 0 &&
    Number(value.elapsedMs) <= 3_600_000
  );
}

function isGuessWordAttempt(value: unknown): value is GuessWordAttempt {
  return (
    isRecord(value) &&
    typeof value.guess === "string" &&
    value.guess.length >= 1 &&
    value.guess.length <= 21 &&
    Number.isInteger(value.elapsedMs) &&
    Number(value.elapsedMs) >= 0 &&
    Number(value.elapsedMs) <= 3_600_000
  );
}

function isQuizProgressEvent(value: unknown): value is QuizProgressEvent {
  return (
    isQuizAttemptAnswer(value) &&
    isRecord(value) &&
    typeof value.clientEventId === "string" &&
    (value.clientOccurredAt === undefined || typeof value.clientOccurredAt === "string")
  );
}

export function isQuizProgressSaved(value: unknown): value is QuizProgressSaved {
  if (!isRecord(value)) return false;
  return (
    value.status === "saved" &&
    Number.isInteger(value.savedEvents) &&
    Number(value.savedEvents) >= 0 &&
    Number.isInteger(value.version) &&
    Number(value.version) >= 1
  );
}

export function isQuizProgressConflict(value: unknown): value is QuizProgressConflict {
  return isRecord(value) && value.code === "VERSION_CONFLICT" && isQuizAttemptState(value.state);
}

export function isQuizSubmitResult(value: unknown): value is QuizSubmitResult {
  if (!isRecord(value) || !isRecord(value.provisional)) return false;
  return (
    typeof value.attemptId === "string" &&
    value.status === "accepted" &&
    typeof value.competitive === "boolean" &&
    typeof value.provisional.completed === "boolean" &&
    Number.isInteger(value.provisional.score) &&
    typeof value.solutionAvailableAt === "string"
  );
}

export function isPublicCrosswordGame(
  value: unknown,
): value is PublicGame & { payload: CrosswordPublicPayload } {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.type === "crossword" &&
    (value.status === "active" || value.status === "disabled") &&
    Number.isInteger(value.contentVersion) &&
    isCrosswordPublicPayload(value.payload)
  );
}

export function isCrosswordPublicPayload(value: unknown): value is CrosswordPublicPayload {
  if (
    !isRecord(value) ||
    value.kind !== "crossword" ||
    typeof value.title !== "string" ||
    (value.difficulty !== undefined &&
      (!Number.isInteger(value.difficulty) ||
        Number(value.difficulty) < 1 ||
        Number(value.difficulty) > 5)) ||
    !Number.isInteger(value.rows) ||
    Number(value.rows) < 3 ||
    Number(value.rows) > 21 ||
    !Number.isInteger(value.columns) ||
    Number(value.columns) < 3 ||
    Number(value.columns) > 21 ||
    !isRecord(value.rules) ||
    value.rules.accentPolicy !== "fold" ||
    !Array.isArray(value.cells) ||
    !Array.isArray(value.blocks) ||
    !Array.isArray(value.entries)
  ) {
    return false;
  }
  return (
    value.cells.every(isCrosswordCellPublic) &&
    value.blocks.every(isCrosswordCoordinate) &&
    value.entries.every(isCrosswordEntryPublic)
  );
}

function isPercent(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100;
}

export function isCrosswordPublicSolutionPayload(
  value: unknown,
): value is CrosswordPublicSolutionPayload {
  return (
    isRecord(value) &&
    value.kind === "crossword-solution" &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.entryId === "string" &&
        typeof entry.answer === "string" &&
        entry.answer.length >= 2,
    )
  );
}

export function isPublicSolution(value: unknown): value is PublicSolution {
  if (
    !isRecord(value) ||
    typeof value.gameId !== "string" ||
    typeof value.publishedAt !== "string" ||
    !isRecord(value.game) ||
    value.game.id !== value.gameId
  ) {
    return false;
  }
  if (
    value.statistics !== undefined &&
    (!isRecord(value.statistics) ||
      !Number.isInteger(value.statistics.attemptCount) ||
      Number(value.statistics.attemptCount) < 20 ||
      !Number.isInteger(value.statistics.averageDurationMs) ||
      Number(value.statistics.averageDurationMs) < 0 ||
      !Number.isInteger(value.statistics.averageScore) ||
      Number(value.statistics.averageScore) < 0 ||
      (value.statistics.observedDifficulty !== undefined &&
        (!Number.isFinite(Number(value.statistics.observedDifficulty)) ||
          Number(value.statistics.observedDifficulty) < 1 ||
          Number(value.statistics.observedDifficulty) > 5)) ||
      (value.statistics.difficultyConfidence !== undefined &&
        (!Number.isFinite(Number(value.statistics.difficultyConfidence)) ||
          Number(value.statistics.difficultyConfidence) < 0 ||
          Number(value.statistics.difficultyConfidence) > 1)))
  ) {
    return false;
  }
  if (
    isRecord(value.statistics) &&
    ((value.statistics.quizQuestions !== undefined &&
      (!Array.isArray(value.statistics.quizQuestions) ||
        !value.statistics.quizQuestions.every(
          (question) =>
            isRecord(question) &&
            typeof question.questionId === "string" &&
            isPercent(question.correctPercent),
        ))) ||
      (value.statistics.crosswordEntries !== undefined &&
        (!Array.isArray(value.statistics.crosswordEntries) ||
          !value.statistics.crosswordEntries.every(
            (entry) =>
              isRecord(entry) &&
              typeof entry.entryId === "string" &&
              isPercent(entry.incorrectPercent),
          ))))
  ) {
    return false;
  }
  return (
    (isPublicQuizStyleGame(value.game) && isQuizPublicSolutionPayload(value.payload)) ||
    (isPublicCrosswordGame(value.game) && isCrosswordPublicSolutionPayload(value.payload)) ||
    (isPublicGuessWordGame(value.game) && isGuessWordPublicSolutionPayload(value.payload)) ||
    (isPublicWordSearchGame(value.game) && isWordSearchPublicSolutionPayload(value.payload))
  );
}

export function isAttemptReview(value: unknown): value is AttemptReview {
  if (
    !isRecord(value) ||
    typeof value.attemptId !== "string" ||
    typeof value.submittedAt !== "string" ||
    !isRecord(value.score) ||
    typeof value.score.competitive !== "boolean" ||
    !Number.isInteger(value.score.points) ||
    Number(value.score.points) < 0 ||
    typeof value.score.scoreVersion !== "string" ||
    !isPublicSolution(value.solution) ||
    !isRecord(value.progress)
  ) {
    return false;
  }
  return (
    (value.progress.kind === "quiz-progress" &&
      Array.isArray(value.progress.answers) &&
      value.progress.answers.every(isQuizAttemptAnswer)) ||
    (value.progress.kind === "crossword-progress" &&
      Array.isArray(value.progress.cells) &&
      value.progress.cells.every(isCrosswordAttemptCell) &&
      Number.isInteger(value.progress.hintsUsed) &&
      Number(value.progress.hintsUsed) >= 0) ||
    (value.progress.kind === "guess-word-progress" &&
      Array.isArray(value.progress.guesses) &&
      value.progress.guesses.every(isGuessWordAttempt)) ||
    (value.progress.kind === "word-search-progress" &&
      Array.isArray(value.progress.foundEntries) &&
      value.progress.foundEntries.every(isWordSearchFoundEntry))
  );
}

export function isLeaderboard(value: unknown): value is Leaderboard {
  return (
    isRecord(value) &&
    (value.scope === "daily" || value.scope === "game" || value.scope === "weekly") &&
    typeof value.key === "string" &&
    Array.isArray(value.entries) &&
    value.entries.every(isLeaderboardEntry) &&
    (value.own === undefined || isLeaderboardPosition(value.own))
  );
}

export function isStreakSummary(value: unknown): value is StreakSummary {
  return (
    isRecord(value) &&
    Number.isInteger(value.best) &&
    Number(value.best) >= 0 &&
    Number.isInteger(value.current) &&
    Number(value.current) >= 0 &&
    (value.lastCompletedDate === null || typeof value.lastCompletedDate === "string")
  );
}

export function isPlayerProgression(value: unknown): value is PlayerProgression {
  return (
    isRecord(value) &&
    Number.isInteger(value.experience) &&
    Number(value.experience) >= 0 &&
    Number.isInteger(value.level) &&
    Number(value.level) >= 1 &&
    Number.isInteger(value.nextLevelExperience) &&
    Number(value.nextLevelExperience) >= 100 &&
    value.version === "xp-v1" &&
    Array.isArray(value.achievements) &&
    value.achievements.length <= 2 &&
    value.achievements.every(
      (achievement) =>
        isRecord(achievement) &&
        typeof achievement.earnedAt === "string" &&
        (achievement.key === "first-game" || achievement.key === "daily-double"),
    )
  );
}

export function isPreviousResultSummaries(value: unknown): value is PreviousResultSummary[] {
  return (
    Array.isArray(value) &&
    value.length <= 2 &&
    value.every(
      (result) =>
        isRecord(result) &&
        typeof result.attemptId === "string" &&
        typeof result.competitive === "boolean" &&
        typeof result.gameId === "string" &&
        (result.gameType === "quiz" ||
          result.gameType === "crossword" ||
          result.gameType === "true_false" ||
          result.gameType === "guess_word" ||
          result.gameType === "word_search") &&
        typeof result.localDate === "string" &&
        Number.isInteger(result.points) &&
        (result.rank === undefined || Number.isInteger(result.rank)) &&
        (result.total === undefined || Number.isInteger(result.total)),
    )
  );
}

export function isUserLeaderboardSettings(value: unknown): value is UserLeaderboardSettings {
  return (
    isRecord(value) &&
    (value.alias === null || typeof value.alias === "string") &&
    typeof value.leaderboardOptIn === "boolean"
  );
}

export function isShareResult(value: unknown): value is ShareResult {
  return isRecord(value) && typeof value.text === "string" && typeof value.url === "string";
}

export function isConsentState(value: unknown): value is ConsentState {
  return (
    isRecord(value) &&
    typeof value.ads === "boolean" &&
    typeof value.analytics === "boolean" &&
    typeof value.policyVersion === "string" &&
    (value.recordedAt === null || typeof value.recordedAt === "string")
  );
}

export function isNotificationPreferences(value: unknown): value is NotificationPreferences {
  return (
    isRecord(value) &&
    typeof value.editionAvailable === "boolean" &&
    typeof value.enabled === "boolean" &&
    typeof value.previousSolution === "boolean" &&
    typeof value.quietEnd === "string" &&
    typeof value.quietStart === "string" &&
    typeof value.timeZone === "string"
  );
}

export function isCrosswordAttemptState(value: unknown): value is CrosswordAttemptState {
  if (!isRecord(value)) return false;
  return (
    typeof value.attemptId === "string" &&
    (value.status === "in_progress" || value.status === "accepted") &&
    Number.isInteger(value.version) &&
    Number(value.version) >= 1 &&
    Number.isInteger(value.hintsUsed) &&
    Number(value.hintsUsed) >= 0 &&
    Array.isArray(value.cells) &&
    value.cells.every(isCrosswordAttemptCell) &&
    (value.result === undefined || isCrosswordSubmitResult(value.result))
  );
}

export function isCrosswordSubmitResult(value: unknown): value is CrosswordSubmitResult {
  return isQuizSubmitResult(value);
}

export function isCrosswordHintResult(value: unknown): value is CrosswordHintResult {
  return (
    isRecord(value) &&
    typeof value.attemptId === "string" &&
    typeof value.cellId === "string" &&
    typeof value.value === "string" &&
    value.competitive === false &&
    Number.isInteger(value.hintsUsed) &&
    Number(value.hintsUsed) >= 1 &&
    Number.isInteger(value.version) &&
    Number(value.version) >= 1
  );
}

export function isCrosswordProgressSaved(value: unknown): value is CrosswordProgressSaved {
  return isQuizProgressSaved(value);
}

export function isCrosswordProgressConflict(value: unknown): value is CrosswordProgressConflict {
  return (
    isRecord(value) && value.code === "VERSION_CONFLICT" && isCrosswordAttemptState(value.state)
  );
}

export function isCrosswordLocalDraft(
  value: unknown,
  gameId: string,
): value is CrosswordLocalDraft {
  if (!isRecord(value)) return false;
  return (
    value.gameId === gameId &&
    typeof value.activeCellId === "string" &&
    typeof value.activeEntryId === "string" &&
    Number.isInteger(value.contentVersion) &&
    Number(value.contentVersion) >= 1 &&
    typeof value.savedAt === "string" &&
    isCrosswordPublicPayload(value.crossword) &&
    isCrosswordAttemptState(value.attempt) &&
    Array.isArray(value.pendingEvents) &&
    value.pendingEvents.every(isCrosswordProgressEvent)
  );
}

function isCrosswordCoordinate(value: unknown): value is CrosswordCoordinate {
  return (
    isRecord(value) &&
    Number.isInteger(value.row) &&
    Number(value.row) >= 0 &&
    Number.isInteger(value.column) &&
    Number(value.column) >= 0
  );
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  return (
    isRecord(value) &&
    typeof value.alias === "string" &&
    Number.isInteger(value.durationMs) &&
    Number(value.durationMs) >= 0 &&
    Number.isInteger(value.points) &&
    Number(value.points) >= 0 &&
    Number.isInteger(value.rank) &&
    Number(value.rank) >= 1
  );
}

function isLeaderboardPosition(value: unknown): value is LeaderboardPosition {
  return (
    isRecord(value) &&
    Number.isInteger(value.durationMs) &&
    Number(value.durationMs) >= 0 &&
    Number.isInteger(value.percentile) &&
    Number(value.percentile) >= 1 &&
    Number(value.percentile) <= 100 &&
    Number.isInteger(value.points) &&
    Number.isInteger(value.rank) &&
    Number.isInteger(value.total)
  );
}

function isCrosswordCellPublic(value: unknown): value is CrosswordCellPublic {
  return (
    isCrosswordCoordinate(value) &&
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.number === undefined || (Number.isInteger(value.number) && Number(value.number) >= 1))
  );
}

function isCrosswordEntryPublic(value: unknown): value is CrosswordEntryPublic {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Number.isInteger(value.number) &&
    Number(value.number) >= 1 &&
    (value.direction === "across" || value.direction === "down") &&
    typeof value.clue === "string" &&
    Array.isArray(value.cellIds) &&
    value.cellIds.length >= 2 &&
    value.cellIds.every((cellId) => typeof cellId === "string")
  );
}

function isCrosswordAttemptCell(value: unknown): value is CrosswordAttemptCell {
  return (
    isRecord(value) &&
    typeof value.cellId === "string" &&
    typeof value.value === "string" &&
    Number.isInteger(value.elapsedMs) &&
    Number(value.elapsedMs) >= 0 &&
    Number(value.elapsedMs) <= 3_600_000
  );
}

function isCrosswordProgressEvent(value: unknown): value is CrosswordProgressEvent {
  return (
    isCrosswordAttemptCell(value) &&
    isRecord(value) &&
    typeof value.clientEventId === "string" &&
    (value.clientOccurredAt === undefined || typeof value.clientOccurredAt === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
