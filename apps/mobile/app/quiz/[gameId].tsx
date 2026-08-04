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
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getPlayerHeaders, type PlayerHeaders } from "../../src/player-auth";
import { LeaderboardPanel } from "../../src/leaderboard-panel";
import { ShareButton } from "../../src/share-button";
import { clientPlatform, durationBucket, scoreBucket, trackAnalytics } from "../../src/analytics";
import { readQuizDraft, removeQuizDraft, writeQuizDraft } from "../../src/quiz-storage";

type PlayingState = {
  attempt: QuizAttemptState;
  contentVersion: number;
  current: number;
  headers: PlayerHeaders;
  quiz: QuizPublicPayload;
};

type SessionState = {
  pendingEvents: readonly QuizProgressEvent[];
  playing: PlayingState;
  syncStatus: "saved" | "syncing" | "pending";
};

export default function QuizScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SessionState>();
  const [result, setResult] = useState<QuizSubmitResult>();
  const [fatalError, setFatalError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const shownAt = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    if (!gameId) {
      setFatalError("El juego no es válido.");
      return () => controller.abort();
    }
    void start(gameId, controller.signal)
      .then(async (state) => {
        startedAt.current = Date.now();
        shownAt.current = performance.now();
        if (state.playing.attempt.result) {
          await removeQuizDraft(gameId);
          setResult(state.playing.attempt.result);
          return;
        }
        void trackAnalytics("GameStarted", {
          attemptId: state.playing.attempt.attemptId,
          entryPoint: state.playing.attempt.answers.length ? "resume" : "daily",
          gameId,
          gameType: "quiz",
          offline: state.syncStatus === "pending",
          platform: clientPlatform(),
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
      .catch(() => {
        if (!controller.signal.aborted) {
          setFatalError("Este quiz no se ha descargado todavía y ahora no hay conexión.");
        }
      });
    return () => controller.abort();
  }, [gameId]);

  useEffect(() => {
    if (!session || !gameId) return;
    void writeQuizDraft(toDraft(gameId, session)).catch(() =>
      setNotice("No se pudo guardar el progreso en este dispositivo."),
    );
  }, [gameId, session]);

  useEffect(() => {
    if (!session?.pendingEvents.length || saving) return;
    const subscription = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void sync(session);
    });
    return () => subscription.remove();
  }, [saving, session]);

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
      <View style={styles.centered}>
        <Text accessibilityRole="header" style={styles.title}>
          No hemos podido continuar
        </Text>
        <Text accessibilityLiveRegion="assertive" style={styles.body}>
          {fatalError}
        </Text>
        <Action label="Volver al inicio" onPress={() => router.replace("/")} />
      </View>
    );
  }
  if (result) {
    return (
      <View style={styles.centered}>
        <Text style={styles.eyebrow}>Resultado provisional</Text>
        <Text accessibilityRole="header" style={styles.score}>
          {result.provisional.score} puntos
        </Text>
        <Text style={styles.body}>
          {result.competitive
            ? "Tu puntuación entra en la clasificación."
            : "Esta partida es casual."}
        </Text>
        <Text style={styles.body}>Las soluciones aparecerán al cerrar la edición.</Text>
        {gameId ? <LeaderboardPanel gameId={gameId} /> : null}
        <ShareButton attemptId={result.attemptId} />
        <Action
          label="Ver revisión al cierre"
          onPress={() => router.push(`/review/${gameId}?attemptId=${result.attemptId}`)}
        />
        <Action label="Volver al inicio" onPress={() => router.replace("/")} />
      </View>
    );
  }
  if (!session) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Preparando el quiz" color="#a83242" size="large" />
      </View>
    );
  }

  const { playing } = session;
  const question = playing.quiz.questions[playing.current];
  if (!question || playing.attempt.status !== "in_progress") {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="header" style={styles.title}>
          Este intento ya se ha enviado
        </Text>
        <Action label="Volver al inicio" onPress={() => router.replace("/")} />
      </View>
    );
  }
  const currentQuestion = question;
  const selected = playing.attempt.answers.find(
    (answer) => answer.questionId === currentQuestion.id,
  )?.selectedOptionId;
  const last = playing.current === playing.quiz.questions.length - 1;

  async function choose(selectedOptionId: string) {
    if (!session || saving) return;
    const event: QuizProgressEvent = {
      clientEventId: Crypto.randomUUID(),
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
        `${apiUrl()}/attempts/${ready.playing.attempt.attemptId}/submit`,
        {
          method: "POST",
          headers: commandHeaders(ready.playing.headers),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok || !isQuizSubmitResult(body)) throw new Error("submit");
      if (gameId) await removeQuizDraft(gameId);
      setResult(body);
      void trackAnalytics("GameCompleted", {
        aidsCount: 0,
        attemptId: body.attemptId,
        competitive: body.competitive,
        durationBucket: durationBucket(Date.now() - startedAt.current),
        gameType: "quiz",
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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>{playing.quiz.title}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.syncStatus}>
        {session.syncStatus === "saved"
          ? "Progreso guardado"
          : session.syncStatus === "syncing"
            ? "Guardando…"
            : "Sin conexión · pendiente de sincronizar"}
      </Text>
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
      <Text style={styles.progress}>
        Pregunta {playing.current + 1} de {playing.quiz.questions.length} ·{" "}
        {currentQuestion.category}
      </Text>
      <Text accessibilityRole="header" style={styles.title}>
        {currentQuestion.prompt}
      </Text>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {currentQuestion.options.map((option) => (
          <Pressable
            accessibilityLabel={option.text}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected === option.id, disabled: saving }}
            disabled={saving}
            key={option.id}
            onPress={() => void choose(option.id)}
            style={[styles.option, selected === option.id && styles.optionSelected]}
          >
            <Text style={styles.optionText}>{option.text}</Text>
          </Pressable>
        ))}
      </View>
      {session.syncStatus === "pending" ? (
        <Action disabled={saving} label="Sincronizar" onPress={() => void sync(session)} />
      ) : null}
      <Action
        disabled={!selected || saving}
        label={saving ? "Guardando…" : last ? "Enviar respuestas" : "Siguiente"}
        onPress={() => void advance()}
      />
    </ScrollView>
  );
}

function Action({
  disabled = false,
  label,
  onPress,
}: Readonly<{ disabled?: boolean; label: string; onPress: () => void }>) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

async function start(gameId: string, signal: AbortSignal): Promise<SessionState> {
  const [headers, cached] = await Promise.all([getPlayerHeaders(signal), readQuizDraft(gameId)]);
  if (!headers) throw new Error("guest");
  try {
    const gameResponse = await fetch(`${apiUrl()}/games/${gameId}`, { signal });
    if (!gameResponse.ok) throw new Error(gameResponse.status === 404 ? "game" : "offline");
    const game: unknown = await gameResponse.json();
    if (!isPublicQuizStyleGame(game)) throw new Error("game");
    const attemptResponse = await fetch(`${apiUrl()}/games/${gameId}/attempts`, {
      method: "POST",
      headers: commandHeaders(headers),
      signal,
    });
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
        headers,
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
        headers,
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
        `${apiUrl()}/attempts/${session.playing.attempt.attemptId}/progress`,
        {
          method: "PUT",
          headers: commandHeaders(session.playing.headers),
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

function commandHeaders(player: PlayerHeaders): Record<string, string> {
  return {
    ...player,
    "Content-Type": "application/json",
    "idempotency-key": Crypto.randomUUID(),
  };
}

function apiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
}

const styles = StyleSheet.create({
  body: { color: "#17233c", fontSize: 18, textAlign: "center" },
  button: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#17233c",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  buttonText: { color: "#fff9ef", fontSize: 18, fontWeight: "700" },
  centered: {
    alignItems: "center",
    backgroundColor: "#fff9ef",
    flex: 1,
    gap: 18,
    justifyContent: "center",
    padding: 24,
  },
  container: { backgroundColor: "#fff9ef", flexGrow: 1, gap: 18, padding: 24, paddingTop: 64 },
  disabled: { opacity: 0.55 },
  eyebrow: { color: "#a83242", fontSize: 16, fontWeight: "700", letterSpacing: 1 },
  notice: { color: "#9b2c2c", fontSize: 16 },
  option: { borderColor: "#71809c", borderRadius: 8, borderWidth: 2, minHeight: 48, padding: 14 },
  optionSelected: { backgroundColor: "#f8dadd", borderColor: "#a83242" },
  optionText: { color: "#17233c", fontSize: 18 },
  options: { gap: 12 },
  progress: { color: "#40506d", fontSize: 16 },
  score: { color: "#17233c", fontSize: 48, fontWeight: "700", textAlign: "center" },
  syncStatus: { color: "#40506d", fontSize: 16, fontWeight: "700" },
  title: { color: "#17233c", fontSize: 30, fontWeight: "700" },
});
