import {
  isGuessWordAttemptState,
  isGuessWordGuessResult,
  isPublicGuessWordGame,
  type GuessWordAttemptState,
  type GuessWordPublicPayload,
} from "@ludico/contracts";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getPlayerHeaders, type PlayerHeaders } from "../../src/player-auth";

type Session = {
  attempt: GuessWordAttemptState;
  game: GuessWordPublicPayload;
  headers: PlayerHeaders;
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

  async function submit() {
    if (!session || !value.trim() || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`${apiUrl()}/attempts/${session.attempt.attemptId}/guesses`, {
        body: JSON.stringify({
          clientEventId: Crypto.randomUUID(),
          elapsedMs: Math.max(0, Date.now() - startedAt.current),
          guess: value,
          version: session.attempt.version,
        }),
        headers: { ...session.headers, "Content-Type": "application/json" },
        method: "POST",
      });
      const body: unknown = await response.json();
      if (!response.ok || !isGuessWordGuessResult(body)) throw new Error("guess");
      setSession({ ...session, attempt: body.attempt });
      setValue("");
      setNotice(
        body.outcome === "correct"
          ? "¡Correcto!"
          : body.outcome === "exhausted"
            ? "Se acabaron los intentos. La solución se publicará al cierre."
            : "No es la palabra. Prueba de nuevo.",
      );
    } catch {
      setNotice("No se ha podido enviar el intento. Vuelve a probarlo.");
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
        editable={!completed && !saving}
        maxLength={21}
        onChangeText={(text) => setValue(text.toLocaleUpperCase("es-ES"))}
        onSubmitEditing={() => void submit()}
        style={styles.input}
        value={value}
      />
      <Action
        disabled={completed || saving || !value.trim()}
        label={saving ? "Comprobando…" : "Comprobar palabra"}
        onPress={() => void submit()}
      />
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
  return { attempt, game: game.payload, headers };
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
