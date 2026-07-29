import { isQuizLocalDraft, type QuizLocalDraft } from "@ludico/contracts";

const prefix = "ludico.quiz-draft.v1.";

export async function readQuizDraft(gameId: string): Promise<QuizLocalDraft | null> {
  try {
    const value = localStorage.getItem(prefix + gameId);
    if (!value) return null;
    const draft: unknown = JSON.parse(value);
    return isQuizLocalDraft(draft, gameId) ? draft : null;
  } catch {
    return null;
  }
}

export async function writeQuizDraft(draft: QuizLocalDraft): Promise<void> {
  localStorage.setItem(prefix + draft.gameId, JSON.stringify(draft));
}

export async function removeQuizDraft(gameId: string): Promise<void> {
  localStorage.removeItem(prefix + gameId);
}
