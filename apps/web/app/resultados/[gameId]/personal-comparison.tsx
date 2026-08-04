"use client";

import {
  isAttemptReview,
  isCrosswordPublicSolutionPayload,
  isPublicCrosswordGame,
  isPublicQuizStyleGame,
  isQuizPublicSolutionPayload,
  type AttemptReview,
} from "@ludico/contracts";
import { foldCrosswordLetter } from "@ludico/domain/crossword";
import { useEffect, useState } from "react";

type State =
  | { status: "loading" | "locked" | "not_found" | "unavailable" }
  | { review: AttemptReview; status: "available" };

export function PersonalComparison({ attemptId }: Readonly<{ attemptId: string }>) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/player/attempts/${attemptId}/review`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 423) return { status: "locked" } as const;
        if (response.status === 401 || response.status === 404)
          return { status: "not_found" } as const;
        const body: unknown = await response.json();
        return response.ok && isAttemptReview(body)
          ? ({ review: body, status: "available" } as const)
          : ({ status: "unavailable" } as const);
      })
      .then((result) => {
        if (!controller.signal.aborted) setState(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "unavailable" });
      });
    return () => controller.abort();
  }, [attemptId]);

  if (state.status === "loading") return <p aria-live="polite">Cargando tu comparación…</p>;
  if (state.status !== "available") {
    return state.status === "locked" ? null : (
      <p role="status">Tu comparación personal no está disponible en esta sesión.</p>
    );
  }

  const { review } = state;
  return (
    <section aria-labelledby="personal-heading" className="personal-review">
      <p className="eyebrow">Tu partida</p>
      <h2 id="personal-heading">{review.score.points} puntos</h2>
      <p>{review.score.competitive ? "Partida competitiva" : "Partida casual"}</p>
      {review.progress.kind === "quiz-progress" &&
      isPublicQuizStyleGame(review.solution.game) &&
      isQuizPublicSolutionPayload(review.solution.payload) ? (
        <QuizComparison review={review} />
      ) : review.progress.kind === "crossword-progress" &&
        isPublicCrosswordGame(review.solution.game) &&
        isCrosswordPublicSolutionPayload(review.solution.payload) ? (
        <CrosswordComparison review={review} />
      ) : null}
    </section>
  );
}

function QuizComparison({ review }: Readonly<{ review: AttemptReview }>) {
  if (
    review.progress.kind !== "quiz-progress" ||
    !isPublicQuizStyleGame(review.solution.game) ||
    !isQuizPublicSolutionPayload(review.solution.payload)
  ) {
    return null;
  }
  const selected = new Map(review.progress.answers.map((answer) => [answer.questionId, answer]));
  const solutions = new Map(
    review.solution.payload.questions.map((answer) => [answer.questionId, answer]),
  );
  return (
    <ol className="comparison-list">
      {review.solution.game.payload.questions.map((question) => {
        const answer = solutions.get(question.id);
        const chosen = selected.get(question.id)?.selectedOptionId;
        const correct = chosen === answer?.correctOptionId;
        return (
          <li className={correct ? "correct" : "incorrect"} key={question.id}>
            <strong>{question.prompt}</strong>
            <span>
              Tu respuesta:{" "}
              {question.options.find((option) => option.id === chosen)?.text ?? "Sin responder"}
            </span>
            <span>{correct ? "Correcta" : "Incorrecta"}</span>
          </li>
        );
      })}
    </ol>
  );
}

function CrosswordComparison({ review }: Readonly<{ review: AttemptReview }>) {
  if (
    review.progress.kind !== "crossword-progress" ||
    !isPublicCrosswordGame(review.solution.game) ||
    !isCrosswordPublicSolutionPayload(review.solution.payload)
  ) {
    return null;
  }
  const cells = new Map(review.progress.cells.map((cell) => [cell.cellId, cell.value]));
  const solutions = new Map(
    review.solution.payload.entries.map((entry) => [entry.entryId, entry.answer]),
  );
  return (
    <>
      <p>Ayudas utilizadas: {review.progress.hintsUsed}</p>
      <ol className="comparison-list">
        {review.solution.game.payload.entries.map((entry) => {
          const value = entry.cellIds.map((cellId) => cells.get(cellId) ?? "_").join("");
          const correct =
            foldCrosswordLetter(value) === foldCrosswordLetter(solutions.get(entry.id) ?? "");
          return (
            <li className={correct ? "correct" : "incorrect"} key={entry.id}>
              <strong>
                {entry.number} {entry.direction === "across" ? "Horizontal" : "Vertical"}
              </strong>
              <span>Tu respuesta: {value}</span>
              <span>{correct ? "Correcta" : "Incorrecta"}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
