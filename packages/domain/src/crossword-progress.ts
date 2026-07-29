import type {
  CrosswordAttemptState,
  CrosswordProgressEvent,
  CrosswordProgressResponse,
} from "@ludico/contracts";

export function applyCrosswordEvents(
  attempt: CrosswordAttemptState,
  events: readonly CrosswordProgressEvent[],
): CrosswordAttemptState {
  const cells = new Map(attempt.cells.map((cell) => [cell.cellId, cell]));
  for (const { cellId, elapsedMs, value } of events) {
    if (value) cells.set(cellId, { cellId, elapsedMs, value });
    else cells.delete(cellId);
  }
  return { ...attempt, cells: [...cells.values()] };
}

export async function synchronizeCrosswordProgress(
  attempt: CrosswordAttemptState,
  events: readonly CrosswordProgressEvent[],
  save: (
    version: number,
    events: readonly CrosswordProgressEvent[],
  ) => Promise<CrosswordProgressResponse>,
): Promise<CrosswordAttemptState> {
  let current = attempt;
  for (let tryNumber = 0; tryNumber < 2; tryNumber += 1) {
    const result = await save(current.version, events);
    if ("status" in result) {
      return { ...applyCrosswordEvents(current, events), version: result.version };
    }
    current = applyCrosswordEvents(result.state, events);
  }
  throw new Error("No se pudo resolver el conflicto de progreso");
}
