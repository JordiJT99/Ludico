"use client";

import {
  isPublicQuizStyleGame,
  isQuizAttemptState,
  isQuizProgressConflict,
  isQuizProgressSaved,
  isQuizSubmitResult,
  type QuizAttemptState,
  type QuizLocalDraft,
  type QuizProgressEvent,
  type QuizPublicPayload,
  type QuizSubmitResult,
} from "@ludico/contracts";
import {
  applyQuizEvents,
  firstUnansweredQuizQuestion,
  synchronizeQuizProgress,
} from "@ludico/domain/quiz-progress";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ensurePlayerSession, renewGuestSession } from "../../player-session";
import { LeaderboardPanel } from "../../leaderboard-panel";
import { ShareButton } from "../../share-button";
import { durationBucket, scoreBucket, trackAnalytics } from "../../analytics";
import { readQuizDraft, removeQuizDraft, writeQuizDraft } from "./quiz-storage";

type PlayingState = {
  attempt: QuizAttemptState;
  contentVersion: number;
  current: number;
  quiz: QuizPublicPayload;
};

type SessionState = {
  pendingEvents: readonly QuizProgressEvent[];
  playing: PlayingState;
  syncStatus: "saved" | "syncing" | "pending";
};

export function QuizPlayer({
  gameId,
  gameType = "quiz",
  title = "Quiz diario",
}: Readonly<{ gameId: string; gameType?: "quiz" | "true_false"; title?: string }>) {
  const [session, setSession] = useState<SessionState>();
  const [result, setResult] = useState<QuizSubmitResult>();
  const [fatalError, setFatalError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const shownAt = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void start(gameId, controller.signal)
      .then(async (state) => {
        startedAt.current = Date.now();
        shownAt.current = performance.now();
        if (state.playing.attempt.result) {
          removeQuizDraft(gameId);
          setResult(state.playing.attempt.result);
          return;
        }
        void trackAnalytics("GameStarted", {
          attemptId: state.playing.attempt.attemptId,
          entryPoint: state.playing.attempt.answers.length ? "resume" : "daily",
          gameId,
          gameType,
          offline: !navigator.onLine,
          platform: "web",
        });
        if (state.pendingEvents.length) {
          try {
            state = await sendPending(state);
          } catch {
            state = { ...state, syncStatus: "pending" };
          }
        }
        setSession(state);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setFatalError(messageFor(cause));
      });
    return () => controller.abort();
  }, [gameId, gameType]);

  useEffect(() => {
    if (!session) return;
    writeQuizDraft(toDraft(gameId, session));
  }, [gameId, session]);

  useEffect(() => {
    if (!session?.pendingEvents.length) return;
    const synchronize = () => void sync(session);
    window.addEventListener("online", synchronize);
    return () => window.removeEventListener("online", synchronize);
  }, [session]);

  async function sync(state: SessionState) {
    setSaving(true);
    setSession({ ...state, syncStatus: "syncing" });
    try {
      setSession(await sendPending(state));
      setNotice(undefined);
    } catch {
      setSession({ ...state, syncStatus: "pending" });
      setNotice("Sin conexión. El progreso queda pendiente en este dispositivo.");
    } finally {
      setSaving(false);
    }
  }

  if (fatalError) {
    return (
      <main className="play-page">
        <p className="eyebrow">{title}</p>
        <h1>No hemos podido abrir este reto</h1>
        <p role="alert">{fatalError}</p>
        <Link className="button-link" href="/">
          Volver al inicio
        </Link>
      </main>
    );
  }
  if (result) {
    return (
      <main className="play-page result-page">
        <header className="play-topbar">
          <Link aria-label="Volver a los retos" className="play-topbar__back" href="/">
            ←
          </Link>
          <Link className="play-topbar__brand" href="/">
            Lúdico
          </Link>
          <span className="play-topbar__status">Resultado</span>
        </header>
        <p className="eyebrow">Resultado provisional</p>
        <h1>{result.provisional.score} puntos</h1>
        <p>
          {result.provisional.completed ? `${title} completado.` : `${title} enviado.`}{" "}
          {result.competitive ? "Tu puntuación entra en la clasificación." : "Partida casual."}
        </p>
        <p>Las soluciones estarán disponibles al cerrar la edición.</p>
        <LeaderboardPanel gameId={gameId} />
        <ShareButton attemptId={result.attemptId} />
        <Link className="button-link" href={`/resultados/${gameId}?attemptId=${result.attemptId}`}>
          Ver revisión al cierre
        </Link>
        <Link className="button-link" href="/">
          Volver al inicio
        </Link>
      </main>
    );
  }
  if (!session) {
    return (
      <main aria-busy="true" className="play-page">
        <header className="play-topbar">
          <Link aria-label="Volver a los retos" className="play-topbar__back" href="/">
            ←
          </Link>
          <Link className="play-topbar__brand" href="/">
            Lúdico
          </Link>
        </header>
        <p className="eyebrow">{title}</p>
        <h1>Preparando las preguntas…</h1>
      </main>
    );
  }

  const { playing } = session;
  const question = playing.quiz.questions[playing.current];
  if (!question || playing.attempt.status !== "in_progress") {
    return (
      <main className="play-page">
        <h1>Este intento ya se ha enviado</h1>
        <Link className="button-link" href="/">
          Volver al inicio
        </Link>
      </main>
    );
  }
  const currentQuestion = question;
  const selected = playing.attempt.answers.find(
    (answer) => answer.questionId === currentQuestion.id,
  )?.selectedOptionId;
  const last = playing.current === playing.quiz.questions.length - 1;
  const progressPercent = Math.round(((playing.current + 1) / playing.quiz.questions.length) * 100);

  async function choose(selectedOptionId: string) {
    if (!session || saving) return;
    const event: QuizProgressEvent = {
      clientEventId: crypto.randomUUID(),
      clientOccurredAt: new Date().toISOString(),
      elapsedMs: Math.max(0, Math.round(performance.now() - shownAt.current)),
      questionId: currentQuestion.id,
      selectedOptionId,
    };
    const next: SessionState = {
      pendingEvents: [...session.pendingEvents, event],
      playing: { ...session.playing, attempt: applyQuizEvents(session.playing.attempt, [event]) },
      syncStatus: "syncing",
    };
    setSession(next);
    await sync(next);
  }

  async function advance() {
    if (!session || !selected || saving) return;
    if (!last) {
      shownAt.current = performance.now();
      setSession({ ...session, playing: { ...playing, current: playing.current + 1 } });
      return;
    }

    setSaving(true);
    let ready = session;
    try {
      if (ready.pendingEvents.length) ready = await sendPending(ready);
      setSession({ ...ready, syncStatus: "saved" });
      const response = await fetch(
        `/api/player/attempts/${ready.playing.attempt.attemptId}/submit`,
        {
          method: "POST",
        },
      );
      const body: unknown = await response.json();
      if (!response.ok || !isQuizSubmitResult(body)) throw new Error("submit");
      removeQuizDraft(gameId);
      setResult(body);
      void trackAnalytics("GameCompleted", {
        aidsCount: 0,
        attemptId: body.attemptId,
        competitive: body.competitive,
        durationBucket: durationBucket(Date.now() - startedAt.current),
        gameType,
        gameId,
        scoreBucket: scoreBucket(body.provisional.score),
      });
      setNotice(undefined);
    } catch {
      setSession({ ...ready, syncStatus: ready.pendingEvents.length ? "pending" : "saved" });
      setNotice(
        ready.pendingEvents.length
          ? "Conecta el dispositivo para sincronizar antes de enviar."
          : "No se pudo enviar el reto. Tus respuestas siguen guardadas.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="play-page quiz-page">
      <header className="play-topbar">
        <Link aria-label="Volver a los retos" className="play-topbar__back" href="/">
          ←
        </Link>
        <Link className="play-topbar__brand" href="/">
          Lúdico
        </Link>
        <span className="play-topbar__status">{title}</span>
      </header>
      <p aria-live="polite" className={`sync-status ${session.syncStatus}`}>
        {session.syncStatus === "saved"
          ? "Progreso guardado"
          : session.syncStatus === "syncing"
            ? "Guardando…"
            : "Sin conexión · pendiente de sincronizar"}
      </p>
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      <p className="progress quiz-legacy-progress">
        Pregunta {playing.current + 1} de {playing.quiz.questions.length} ·{" "}
        {currentQuestion.category}
      </p>
      <div className="question-meta">
        <p>
          Pregunta {playing.current + 1} de {playing.quiz.questions.length}
        </p>
        <span>{progressPercent}%</span>
      </div>
      <div
        aria-label={`${progressPercent}% completado`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progressPercent}
        className="progress-track"
        role="progressbar"
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <section aria-labelledby="question-heading" className="quiz-card">
        <p className="eyebrow">{currentQuestion.category}</p>
        <h1 id="question-heading">{currentQuestion.prompt}</h1>
        <fieldset disabled={saving}>
          <legend>Elige una respuesta</legend>
          <div className="options">
            {currentQuestion.options.map((option, index) => (
              <label
                className={selected === option.id ? "option selected" : "option"}
                key={option.id}
              >
                <input
                  checked={selected === option.id}
                  name={currentQuestion.id}
                  onChange={() => void choose(option.id)}
                  type="radio"
                  value={option.id}
                />
                <span aria-hidden="true" className="option__letter">
                  {String.fromCharCode(65 + index)}
                </span>
                <span>{option.text}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {session.syncStatus === "pending" ? (
          <button disabled={saving} onClick={() => void sync(session)} type="button">
            Sincronizar
          </button>
        ) : null}
        <button
          className="primary-action"
          disabled={!selected || saving}
          onClick={() => void advance()}
          type="button"
        >
          {saving ? "Guardando…" : last ? "Enviar respuestas" : "Siguiente"}
        </button>
      </section>
    </main>
  );
}

async function start(
  gameId: string,
  signal: AbortSignal,
  canRenewGuestSession = true,
): Promise<SessionState> {
  const cached = readQuizDraft(gameId);
  try {
    if (!(await ensurePlayerSession(signal))) throw new Error("offline");
    const gameResponse = await fetch(`/api/player/games/${gameId}`, { signal });
    if (!gameResponse.ok) throw new Error(gameResponse.status === 404 ? "game" : "offline");
    const game: unknown = await gameResponse.json();
    if (!isPublicQuizStyleGame(game)) throw new Error("game");
    const attemptResponse = await fetch(`/api/player/games/${gameId}/attempts`, {
      method: "POST",
      signal,
    });
    if (
      attemptResponse.status === 401 &&
      canRenewGuestSession &&
      (await renewGuestSession(signal))
    ) {
      return start(gameId, signal, false);
    }
    if (!attemptResponse.ok) throw new Error("offline");
    const attempt: unknown = await attemptResponse.json();
    if (!isQuizAttemptState(attempt)) throw new Error("attempt");
    const pendingEvents =
      cached?.attempt.attemptId === attempt.attemptId &&
      cached.contentVersion === game.contentVersion
        ? cached.pendingEvents
        : [];
    const mergedAttempt = applyQuizEvents(attempt, pendingEvents);
    return {
      pendingEvents,
      playing: {
        attempt: mergedAttempt,
        contentVersion: game.contentVersion,
        current:
          cached?.attempt.attemptId === attempt.attemptId &&
          cached.contentVersion === game.contentVersion
            ? Math.min(cached.current, game.payload.questions.length - 1)
            : firstUnansweredQuizQuestion(game.payload, mergedAttempt),
        quiz: game.payload,
      },
      syncStatus: pendingEvents.length ? "pending" : "saved",
    };
  } catch (cause) {
    if (cause instanceof Error && cause.message === "game") throw cause;
    if (!cached) throw cause;
    return {
      pendingEvents: cached.pendingEvents,
      playing: {
        attempt: cached.attempt,
        contentVersion: cached.contentVersion,
        current: cached.current,
        quiz: cached.quiz,
      },
      syncStatus: cached.pendingEvents.length ? "pending" : "saved",
    };
  }
}

async function sendPending(session: SessionState): Promise<SessionState> {
  if (!session.pendingEvents.length) return { ...session, syncStatus: "saved" };
  const attempt = await synchronizeQuizProgress(
    session.playing.attempt,
    session.pendingEvents,
    async (version, events) => {
      const response = await fetch(
        `/api/player/attempts/${session.playing.attempt.attemptId}/progress`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events, version }),
        },
      );
      const body: unknown = await response.json();
      if (response.status === 409 && isQuizProgressConflict(body)) return body;
      if (!response.ok || !isQuizProgressSaved(body)) throw new Error("sync");
      return body;
    },
  );
  return {
    pendingEvents: [],
    playing: { ...session.playing, attempt },
    syncStatus: "saved",
  };
}

function toDraft(gameId: string, session: SessionState): QuizLocalDraft {
  return {
    attempt: session.playing.attempt,
    contentVersion: session.playing.contentVersion,
    current: session.playing.current,
    gameId,
    pendingEvents: session.pendingEvents,
    quiz: session.playing.quiz,
    savedAt: new Date().toISOString(),
  };
}

function messageFor(cause: unknown): string {
  return cause instanceof Error && cause.message === "game"
    ? "Este juego no está disponible ahora mismo."
    : "Este quiz no se ha descargado todavía y ahora no hay conexión.";
}
