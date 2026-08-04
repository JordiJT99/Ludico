import {
  isCrosswordPublicSolutionPayload,
  isPublicCrosswordGame,
  isPublicQuizStyleGame,
  isPublicSolution,
  isQuizPublicSolutionPayload,
  type PublicSolution,
} from "@ludico/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { AnalyticsEvent } from "../../analytics-event";
import { LeaderboardPanel } from "../../leaderboard-panel";
import { ShareButton } from "../../share-button";
import { SiteHeader } from "../../site-header";
import { PersonalComparison } from "./personal-comparison";

type PageProps = Readonly<{
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ attemptId?: string }>;
}>;
type SolutionLoad =
  | { status: "available"; solution: PublicSolution }
  | { status: "locked" | "not_found" | "unavailable" };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { gameId } = await params;
  const result = await loadSolution(gameId);
  return result.status === "available"
    ? { title: `Solución · ${result.solution.game.type === "quiz" ? "Quiz" : "Crucigrama"}` }
    : { robots: { follow: false, index: false }, title: "Solución pendiente · Lúdico" };
}

export default async function ResultPage({ params, searchParams }: PageProps) {
  const { gameId } = await params;
  const { attemptId } = await searchParams;
  const result = await loadSolution(gameId);

  if (result.status !== "available") {
    return (
      <>
        <SiteHeader />
        <main className="content-page result-page">
          <p className="eyebrow">Revisión diaria</p>
          <h1>
            {result.status === "locked" ? "La solución aún está cerrada" : "Revisión no disponible"}
          </h1>
          <p role="status">
            {result.status === "locked"
              ? "Podrás revisar las respuestas cuando termine la edición. Hasta entonces no mostramos ninguna pista de la solución."
              : "No hemos podido encontrar esta revisión. Puedes volver a intentarlo desde el inicio."}
          </p>
          <Link className="button-link" href="/">
            Volver al inicio
          </Link>
        </main>
      </>
    );
  }

  const { solution } = result;
  return (
    <>
      <SiteHeader />
      <main className="content-page result-page">
        <AnalyticsEvent
          name="ResultViewed"
          properties={{
            daysAgo: Math.max(
              0,
              Math.floor((Date.now() - Date.parse(solution.publishedAt)) / (24 * 60 * 60 * 1_000)),
            ),
            ...(attemptId ? { attemptId } : {}),
            gameId,
            gameType: solution.game.type,
            platform: "web",
          }}
        />
        <p className="eyebrow">Revisión publicada</p>
        {isPublicQuizStyleGame(solution.game) && isQuizPublicSolutionPayload(solution.payload) ? (
          <QuizSolution solution={solution} />
        ) : isPublicCrosswordGame(solution.game) &&
          isCrosswordPublicSolutionPayload(solution.payload) ? (
          <CrosswordSolution solution={solution} />
        ) : (
          <p role="alert">La revisión publicada no tiene un formato válido.</p>
        )}
        {solution.statistics ? (
          <section aria-labelledby="global-comparison-heading">
            <h2 id="global-comparison-heading">Comparación global</h2>
            <p>
              Media de {solution.statistics.attemptCount} partidas competitivas:{" "}
              <strong>{solution.statistics.averageScore} puntos</strong> en{" "}
              {formatDuration(solution.statistics.averageDurationMs)}.
            </p>
          </section>
        ) : (
          <p>Aún no hay suficientes partidas para publicar estadísticas agregadas.</p>
        )}
        {attemptId ? <PersonalComparison attemptId={attemptId} /> : null}
        <LeaderboardPanel gameId={gameId} />
        {attemptId ? <ShareButton attemptId={attemptId} /> : null}
        <Link className="button-link" href="/">
          Volver al inicio
        </Link>
      </main>
    </>
  );
}

function QuizSolution({ solution }: Readonly<{ solution: PublicSolution }>) {
  if (!isPublicQuizStyleGame(solution.game) || !isQuizPublicSolutionPayload(solution.payload))
    return null;
  const answers = new Map(solution.payload.questions.map((answer) => [answer.questionId, answer]));
  const percentages = new Map(
    solution.statistics?.quizQuestions?.map((question) => [
      question.questionId,
      question.correctPercent,
    ]),
  );
  return (
    <section className="solution-section">
      <h1>{solution.game.payload.title}</h1>
      <p>Solución publicada el {formatPublishedAt(solution.publishedAt)}.</p>
      <ol className="review-list">
        {solution.game.payload.questions.map((question) => {
          const answer = answers.get(question.id);
          const correct = question.options.find((option) => option.id === answer?.correctOptionId);
          return (
            <li key={question.id}>
              <h2>{question.prompt}</h2>
              <p>
                Respuesta: <strong>{correct?.text ?? "No disponible"}</strong>
              </p>
              {answer ? <p>{answer.explanation}</p> : null}
              {percentages.has(question.id) ? (
                <p>El {percentages.get(question.id)}% acertó esta pregunta.</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function CrosswordSolution({ solution }: Readonly<{ solution: PublicSolution }>) {
  if (
    !isPublicCrosswordGame(solution.game) ||
    !isCrosswordPublicSolutionPayload(solution.payload)
  ) {
    return null;
  }
  const crossword = solution.game.payload;
  const solutionPayload = solution.payload;
  const answers = new Map(solutionPayload.entries.map((entry) => [entry.entryId, entry.answer]));
  const percentages = new Map(
    solution.statistics?.crosswordEntries?.map((entry) => [entry.entryId, entry.incorrectPercent]),
  );
  const letters = new Map<string, string>();
  for (const entry of crossword.entries) {
    const answer = Array.from(answers.get(entry.id) ?? "");
    entry.cellIds.forEach((cellId, index) => letters.set(cellId, answer[index] ?? ""));
  }
  return (
    <section className="solution-section">
      <h1>{solution.game.payload.title}</h1>
      <p>Solución publicada el {formatPublishedAt(solution.publishedAt)}.</p>
      <div
        aria-label="Solución del crucigrama"
        className="crossword-grid solution-grid"
        role="img"
        style={{ gridTemplateColumns: `repeat(${crossword.columns}, 1fr)` }}
      >
        {Array.from({ length: crossword.rows * crossword.columns }, (_, index) => {
          const row = Math.floor(index / crossword.columns);
          const column = index % crossword.columns;
          const cell = crossword.cells.find(
            (candidate) => candidate.row === row && candidate.column === column,
          );
          return cell ? (
            <span className="crossword-cell solution-cell" key={cell.id}>
              {cell.number ? <span className="crossword-number">{cell.number}</span> : null}
              <span className="crossword-letter">{letters.get(cell.id)}</span>
            </span>
          ) : (
            <span aria-hidden="true" className="crossword-block" key={`${row}:${column}`} />
          );
        })}
      </div>
      <ol className="review-list">
        {crossword.entries.map((entry) => (
          <li key={entry.id}>
            <h2>
              {entry.number} {entry.direction === "across" ? "Horizontal" : "Vertical"}.{" "}
              {entry.clue}
            </h2>
            <p>
              Respuesta: <strong>{answers.get(entry.id) ?? "No disponible"}</strong>
            </p>
            {percentages.has(entry.id) ? (
              <p>El {percentages.get(entry.id)}% falló esta palabra.</p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

async function loadSolution(gameId: string): Promise<SolutionLoad> {
  try {
    const apiUrl = process.env.PUBLIC_API_URL ?? "http://localhost:4000/v1";
    const response = await fetch(`${apiUrl}/games/${gameId}/solution`, { cache: "no-store" });
    if (response.status === 423) return { status: "locked" };
    if (response.status === 404) return { status: "not_found" };
    const body: unknown = await response.json();
    return response.ok && isPublicSolution(body)
      ? { solution: body, status: "available" }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

function formatPublishedAt(value: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(new Date(value));
}

function formatDuration(value: number): string {
  const seconds = Math.round(value / 1_000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
