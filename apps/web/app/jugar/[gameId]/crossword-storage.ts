import { isCrosswordLocalDraft, type CrosswordLocalDraft } from "@ludico/contracts";

const prefix = "ludico:crossword:";

export function readCrosswordDraft(gameId: string): CrosswordLocalDraft | null {
  try {
    const raw = localStorage.getItem(`${prefix}${gameId}`);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isCrosswordLocalDraft(value, gameId) ? value : null;
  } catch {
    return null;
  }
}

export function writeCrosswordDraft(draft: CrosswordLocalDraft): void {
  try {
    localStorage.setItem(`${prefix}${draft.gameId}`, JSON.stringify(draft));
  } catch {
    // El estado remoto sigue siendo la fuente canónica si el almacenamiento local no está disponible.
  }
}

export function removeCrosswordDraft(gameId: string): void {
  try {
    localStorage.removeItem(`${prefix}${gameId}`);
  } catch {
    // No impide mostrar un resultado ya aceptado.
  }
}
