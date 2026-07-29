import { isQuizLocalDraft, type QuizLocalDraft } from "@ludico/contracts";

const prefix = "ludico.quiz-draft.v1.";

export function readQuizDraft(gameId: string): QuizLocalDraft | null {
  try {
    const value = localStorage.getItem(prefix + gameId);
    if (!value) return null;
    const draft: unknown = JSON.parse(value);
    return isQuizLocalDraft(draft, gameId) ? draft : null;
  } catch {
    return null;
  }
}

export function writeQuizDraft(draft: QuizLocalDraft): void {
  try {
    localStorage.setItem(prefix + draft.gameId, JSON.stringify(draft));
  } catch {
    // The remote save remains authoritative if browser storage is unavailable.
  }
}

export function removeQuizDraft(gameId: string): void {
  try {
    localStorage.removeItem(prefix + gameId);
  } catch {
    // Nothing else can remove browser-owned storage.
  }
}
