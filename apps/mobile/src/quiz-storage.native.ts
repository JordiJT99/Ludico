import { isQuizLocalDraft, type QuizLocalDraft } from "@ludico/contracts";
import Storage from "expo-sqlite/kv-store";

const prefix = "ludico.quiz-draft.v1.";

export async function readQuizDraft(gameId: string): Promise<QuizLocalDraft | null> {
  try {
    const value = await Storage.getItem(prefix + gameId);
    if (!value) return null;
    const draft: unknown = JSON.parse(value);
    return isQuizLocalDraft(draft, gameId) ? draft : null;
  } catch {
    return null;
  }
}

export async function writeQuizDraft(draft: QuizLocalDraft): Promise<void> {
  await Storage.setItem(prefix + draft.gameId, JSON.stringify(draft));
}

export async function removeQuizDraft(gameId: string): Promise<void> {
  await Storage.removeItem(prefix + gameId);
}
