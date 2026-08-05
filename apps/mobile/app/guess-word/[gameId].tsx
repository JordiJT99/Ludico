import {
  isGuessWordAttemptState,
  isGuessWordGuessResult,
  isPublicGuessWordGame,
  type GuessWordAttemptState,
  type GuessWordGuessEvent,
  type GuessWordLocalDraft,
  type GuessWordPublicPayload,
} from "@ludico/contracts";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getPlayerHeaders } from "../../src/player-auth";
import {
  readGuessWordDraft,
  removeGuessWordDraft,
  writeGuessWordDraft,
} from "../../src/guess-word-storage";

type Session = {
  attempt: GuessWordAttemptState;
  contentVersion: number;
  game: GuessWordPublicPayload;
  pendingEvents: readonly GuessWordGuessEvent[];
};

export default function GuessWordScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<Session>();
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const startedAt = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    if (!gameId) return () => controller.abort();
    void start(gameId, controller.signal)
      .then((state) => {
        startedAt.current = Date.now();
        setSession(state);
      })
      .catch(() => setNotice("No se ha podido abrir este reto."));
    return () => controller.abort();
  }, [gameId]);

  useEffect(() => {
    if (!session || !gameId) return;
    void writeGuessWordDraft(toDraft(gameId, session));
  }, [gameId, session]);

  useEffect(() => {
    if (!session?.pendingEvents.length) return;
    const subscription = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) syncPending(session);
    });
    return () => subscription.remove();
  }, [session]);

  function syncPending(source: Session) {
    void sync(source)
      .then((next) => setSession(next))
      .catch(() => setNotice("El intento sigue pendiente de sincronizar."));
  }

  async function submit() {
    if (!session || !value.trim() || saving) return;
    setSaving(true);
    const event: GuessWordGuessEvent = {
      clientEventId: Crypto.randomUUID(),
      elapsedMs: Math.max(0, Date.now() - startedAt.current),
      guess: value,
      version: session.attempt.version,
    };
    try {
      const ready = session.pendingEvents.length ? await sync(session) : session;
      const result = await sendGuess(ready, event);
      const next = result.session;
      setSession(next);
      setValue("");
      setNotice(
        result.outcome === "correct"
          ? "¡Correcto!"
          : result.outcome === "exhausted"
            ? "Se acabaron los intentos. La solución se publicará al cierre."
            : "No es la palabra. Prueba de nuevo.",
      );
      if (next.attempt.result && gameId) await removeGuessWordDraft(gameId);
    } catch {
      setSession({ ...session, pendingEvents: [...session.pendingEvents, event] });
      setValue("");
      setNotice("Intento guardado. Se comprobará al recuperar la conexión.");
    } finally {
      setSaving(false);
    }
  }

  if (!session) {
    return (
      <View style={styles.centered}>
        <Text style={styles.body}>{notice ?? "Preparando el reto…"}</Text>
      </View>
    );
  }
  const completed = session.attempt.status === "accepted";
  const pending = session.pendingEvents.length > 0;
  const hints = session.game.hints.filter(
    (hint) => hint.unlockAfterAttempts <= session.attempt.guesses.length,
  );
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>{session.game.category}</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {session.game.definition}
      </Text>
      <Text style={styles.body}>
        Intentos: {session.attempt.guesses.length} de {session.game.maxAttempts}
      </Text>
      <TextInput
        accessibilityLabel="Escribe tu respuesta"
        autoCapitalize="characters"
        editable={!completed && !saving && !pending}
        maxLength={21}
        onChangeText={(text) => setValue(text.toLocaleUpperCase("es-ES"))}
        onSubmitEditing={() => void submit()}
        style={styles.input}
        value={value}
      />
      <Action
        disabled={completed || saving || pending || !value.trim()}
        label={saving ? "Comprobando…" : pending ? "Intento pendiente" : "Comprobar palabra"}
        onPress={() => void submit()}
      />
      {pending ? <Action label="Sincronizar intento" onPress={() => syncPending(session)} /> : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          {notice}
        </Text>
      ) : null}
      {hints.map((hint) => (
        <Text key={`${hint.unlockAfterAttempts}:${hint.text}`} style={styles.hint}>
          Pista: {hint.text}
        </Text>
      ))}
      {session.attempt.guesses.length ? (
        <Text style={styles.body}>
          Probadas: {session.attempt.guesses.map((guess) => guess.guess).join(", ")}
        </Text>
      ) : null}
      {session.attempt.result ? (
        <>
          <Text style={styles.score}>{session.attempt.result.provisional.score} puntos</Text>
          <Action label="Volver al inicio" onPress={() => router.replace("/")} />
        </>
      ) : null}
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
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

async function start(gameId: string, signal: AbortSignal): Promise<Session> {
  const cached = await readGuessWordDraft(gameId);
  try {
    const headers = await getPlayerHeaders(signal);
    if (!headers) throw new Error("guest");
    const gameResponse = await fetch(`${apiUrl()}/games/${gameId}`, { signal });
    const game: unknown = await gameResponse.json();
    if (!gameResponse.ok || !isPublicGuessWordGame(game)) throw new Error("game");
    const attemptResponse = await fetch(`${apiUrl()}/games/${gameId}/attempts`, {
      headers,
      method: "POST",
      signal,
    });
    const attempt: unknown = await attemptResponse.json();
    if (!attemptResponse.ok || !isGuessWordAttemptState(attempt)) throw new Error("attempt");
    return {
      attempt,
      contentVersion: game.contentVersion,
      game: game.payload,
      pendingEvents:
        cached?.attempt.attemptId === attempt.attemptId &&
        cached.contentVersion === game.contentVersion
          ? cached.pendingEvents
          : [],
    };
  } catch {
    if (!cached) throw new Error("offline");
    return {
      attempt: cached.attempt,
      contentVersion: cached.contentVersion,
      game: cached.game,
      pendingEvents: cached.pendingEvents,
    };
  }
}

async function sync(session: Session): Promise<Session> {
  let next = { ...session, pendingEvents: [] as readonly GuessWordGuessEvent[] };
  for (const event of session.pendingEvents) next = (await sendGuess(next, event)).session;
  return next;
}

async function sendGuess(
  session: Session,
  event: GuessWordGuessEvent,
): Promise<{ outcome: "correct" | "incorrect" | "exhausted"; session: Session }> {
  const headers = await getPlayerHeaders(new AbortController().signal);
  if (!headers) throw new Error("guest");
  const response = await fetch(`${apiUrl()}/attempts/${session.attempt.attemptId}/guesses`, {
    body: JSON.stringify({ ...event, version: session.attempt.version }),
    headers: { ...headers, "Content-Type": "application/json" },
    method: "POST",
  });
  const body: unknown = await response.json();
  if (!response.ok || !isGuessWordGuessResult(body)) throw new Error("guess");
  return { outcome: body.outcome, session: { ...session, attempt: body.attempt } };
}

function toDraft(gameId: string, session: Session): GuessWordLocalDraft {
  return {
    attempt: session.attempt,
    contentVersion: session.contentVersion,
    game: session.game,
    gameId,
    pendingEvents: session.pendingEvents,
    savedAt: new Date().toISOString(),
  };
}

function apiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
}

const styles = StyleSheet.create({
  body: { color: "#17233c", fontSize: 17, lineHeight: 24 },
  button: {
    alignItems: "center",
    backgroundColor: "#17233c",
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonText: { color: "#fff9ef", fontSize: 17, fontWeight: "700" },
  centered: {
    alignItems: "center",
    backgroundColor: "#fff9ef",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  container: { backgroundColor: "#fff9ef", flexGrow: 1, gap: 16, padding: 24 },
  disabled: { opacity: 0.5 },
  eyebrow: { color: "#a83242", fontSize: 16, fontWeight: "700" },
  hint: { backgroundColor: "#f4e5bd", color: "#17233c", fontSize: 16, padding: 12 },
  input: {
    backgroundColor: "#fff",
    borderColor: "#71809c",
    borderWidth: 1,
    borderRadius: 8,
    color: "#17233c",
    fontSize: 20,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  score: { color: "#a83242", fontSize: 32, fontWeight: "700" },
  title: { color: "#17233c", fontSize: 30, fontWeight: "700", lineHeight: 38 },
});
