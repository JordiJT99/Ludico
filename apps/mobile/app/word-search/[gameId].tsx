import {
  isPublicWordSearchGame,
  isWordSearchAttemptState,
  isWordSearchSelectionResult,
  type WordSearchAttemptState,
  type WordSearchPublicPayload,
} from "@ludico/contracts";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getPlayerHeaders, type PlayerHeaders } from "../../src/player-auth";

type Coordinate = { column: number; row: number };
type Session = {
  attempt: WordSearchAttemptState;
  game: WordSearchPublicPayload;
  headers: PlayerHeaders;
};

export default function WordSearchScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<Session>();
  const [selectedWordId, setSelectedWordId] = useState<string>();
  const [start, setStart] = useState<Coordinate>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const startedAt = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    if (!gameId) return () => controller.abort();
    void startGame(gameId, controller.signal)
      .then((state) => {
        startedAt.current = Date.now();
        setSession(state);
      })
      .catch(() => setNotice("No se ha podido abrir este reto."));
    return () => controller.abort();
  }, [gameId]);

  async function chooseCell(coordinate: Coordinate) {
    if (!session || saving || session.attempt.status !== "in_progress") return;
    if (!selectedWordId) return setNotice("Elige primero una palabra.");
    if (!start) return setStart(coordinate);
    setSaving(true);
    try {
      const response = await fetch(
        `${apiUrl()}/attempts/${session.attempt.attemptId}/word-search-selections`,
        {
          body: JSON.stringify({
            clientEventId: Crypto.randomUUID(),
            elapsedMs: Math.max(0, Date.now() - startedAt.current),
            endColumn: coordinate.column,
            endRow: coordinate.row,
            entryId: selectedWordId,
            startColumn: start.column,
            startRow: start.row,
            version: session.attempt.version,
          }),
          headers: { ...session.headers, "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const body: unknown = await response.json();
      if (!response.ok || !isWordSearchSelectionResult(body)) throw new Error("selection");
      setSession({ ...session, attempt: body.attempt });
      setStart(undefined);
      setNotice(
        body.outcome === "found"
          ? "Palabra encontrada."
          : body.outcome === "already_found"
            ? "Esa palabra ya estaba encontrada."
            : "Esa selección no coincide.",
      );
    } catch {
      setNotice("No se ha podido comprobar la selección. Vuelve a probarlo.");
    } finally {
      setSaving(false);
    }
  }

  if (!session) {
    return (
      <View style={styles.centered}>
        <Text style={styles.body}>{notice ?? "Preparando la sopa de letras…"}</Text>
      </View>
    );
  }
  const found = new Set(session.attempt.foundEntries.map((entry) => entry.entryId));
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {session.game.title}
      </Text>
      <Text style={styles.body}>Elige una palabra y toca su primera y última letra.</Text>
      <View accessibilityLabel="Sopa de letras" style={styles.grid}>
        {session.game.grid.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.gridRow}>
            {row.map((letter, column) => {
              const active = start?.row === rowIndex && start.column === column;
              return (
                <Pressable
                  accessibilityLabel={`Fila ${rowIndex + 1}, columna ${column + 1}: ${letter}`}
                  key={`${rowIndex}:${column}`}
                  onPress={() => void chooseCell({ column, row: rowIndex })}
                  style={[styles.cell, active && styles.cellActive]}
                >
                  <Text style={styles.cellText}>{letter}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <View accessibilityLabel="Palabras por encontrar" style={styles.words}>
        {session.game.words.map((word) => (
          <Pressable
            accessibilityRole="button"
            disabled={found.has(word.id) || session.attempt.status !== "in_progress"}
            key={word.id}
            onPress={() => {
              setSelectedWordId(word.id);
              setStart(undefined);
            }}
            style={[
              styles.word,
              (found.has(word.id) || selectedWordId === word.id) && styles.wordSelected,
            ]}
          >
            <Text style={styles.wordText}>
              {word.answer}
              {found.has(word.id) ? " ✓" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          {notice}
        </Text>
      ) : null}
      {session.attempt.result ? (
        <>
          <Text style={styles.score}>{session.attempt.result.provisional.score} puntos</Text>
          <Pressable onPress={() => router.replace("/")} style={styles.button}>
            <Text style={styles.buttonText}>Volver al inicio</Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

async function startGame(gameId: string, signal: AbortSignal): Promise<Session> {
  const headers = await getPlayerHeaders(signal);
  if (!headers) throw new Error("guest");
  const gameResponse = await fetch(`${apiUrl()}/games/${gameId}`, { signal });
  const game: unknown = await gameResponse.json();
  if (!gameResponse.ok || !isPublicWordSearchGame(game)) throw new Error("game");
  const attemptResponse = await fetch(`${apiUrl()}/games/${gameId}/attempts`, {
    headers,
    method: "POST",
    signal,
  });
  const attempt: unknown = await attemptResponse.json();
  if (!attemptResponse.ok || !isWordSearchAttemptState(attempt)) throw new Error("attempt");
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
  cell: {
    alignItems: "center",
    borderColor: "#71809c",
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 36,
  },
  cellActive: { backgroundColor: "#f4e5bd", borderColor: "#a83242", borderWidth: 2 },
  cellText: { color: "#17233c", fontSize: 16, fontWeight: "700" },
  centered: {
    alignItems: "center",
    backgroundColor: "#fff9ef",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  container: { backgroundColor: "#fff9ef", flexGrow: 1, gap: 16, padding: 24 },
  grid: { borderColor: "#17233c", borderWidth: 2 },
  gridRow: { flexDirection: "row" },
  score: { color: "#a83242", fontSize: 32, fontWeight: "700" },
  title: { color: "#17233c", fontSize: 30, fontWeight: "700", lineHeight: 38 },
  word: { borderColor: "#71809c", borderRadius: 8, borderWidth: 1, padding: 10 },
  wordSelected: { backgroundColor: "#f4e5bd", borderColor: "#a83242" },
  wordText: { color: "#17233c", fontSize: 16, fontWeight: "700" },
  words: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
