import {
  isPublicWordSearchGame,
  isWordSearchAttemptState,
  isWordSearchSelectionResult,
  type WordSearchAttemptState,
  type WordSearchLocalDraft,
  type WordSearchPublicPayload,
  type WordSearchSelectionEvent,
} from "@ludico/contracts";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getPlayerHeaders } from "../../src/player-auth";
import {
  readWordSearchDraft,
  removeWordSearchDraft,
  writeWordSearchDraft,
} from "../../src/word-search-storage";

type Coordinate = { column: number; row: number };
type Session = {
  attempt: WordSearchAttemptState;
  contentVersion: number;
  game: WordSearchPublicPayload;
  pendingEvents: readonly WordSearchSelectionEvent[];
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

  useEffect(() => {
    if (!session || !gameId) return;
    void writeWordSearchDraft(toDraft(gameId, session));
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
      .then((next) => {
        setSession(next);
        setNotice("Selección sincronizada.");
      })
      .catch(() => setNotice("La selección sigue pendiente de sincronizar."));
  }

  async function chooseCell(coordinate: Coordinate) {
    if (
      !session ||
      saving ||
      session.pendingEvents.length ||
      session.attempt.status !== "in_progress"
    )
      return;
    if (!selectedWordId) return setNotice("Elige primero una palabra.");
    if (!start) return setStart(coordinate);
    setSaving(true);
    const event: WordSearchSelectionEvent = {
      clientEventId: Crypto.randomUUID(),
      elapsedMs: Math.max(0, Date.now() - startedAt.current),
      endColumn: coordinate.column,
      endRow: coordinate.row,
      entryId: selectedWordId,
      startColumn: start.column,
      startRow: start.row,
      version: session.attempt.version,
    };
    try {
      const ready = session.pendingEvents.length ? await sync(session) : session;
      const result = await sendSelection(ready, event);
      setSession(result.session);
      setStart(undefined);
      setNotice(
        result.outcome === "found"
          ? "Palabra encontrada."
          : result.outcome === "already_found"
            ? "Esa palabra ya estaba encontrada."
            : "Esa selección no coincide.",
      );
      if (result.session.attempt.result && gameId) await removeWordSearchDraft(gameId);
    } catch {
      setSession({ ...session, pendingEvents: [...session.pendingEvents, event] });
      setStart(undefined);
      setNotice("Selección guardada. Se comprobará al recuperar la conexión.");
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
  const pending = session.pendingEvents.length > 0;
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
            disabled={pending || found.has(word.id) || session.attempt.status !== "in_progress"}
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
      {pending ? (
        <Pressable onPress={() => syncPending(session)} style={styles.button}>
          <Text style={styles.buttonText}>Sincronizar selección</Text>
        </Pressable>
      ) : null}
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
  const cached = await readWordSearchDraft(gameId);
  try {
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
  let next = { ...session, pendingEvents: [] as readonly WordSearchSelectionEvent[] };
  for (const event of session.pendingEvents) next = (await sendSelection(next, event)).session;
  return next;
}

async function sendSelection(
  session: Session,
  event: WordSearchSelectionEvent,
): Promise<{ outcome: "found" | "incorrect" | "already_found"; session: Session }> {
  const headers = await getPlayerHeaders(new AbortController().signal);
  if (!headers) throw new Error("guest");
  const response = await fetch(
    `${apiUrl()}/attempts/${session.attempt.attemptId}/word-search-selections`,
    {
      body: JSON.stringify({ ...event, version: session.attempt.version }),
      headers: { ...headers, "Content-Type": "application/json" },
      method: "POST",
    },
  );
  const body: unknown = await response.json();
  if (!response.ok || !isWordSearchSelectionResult(body)) throw new Error("selection");
  return { outcome: body.outcome, session: { ...session, attempt: body.attempt } };
}

function toDraft(gameId: string, session: Session): WordSearchLocalDraft {
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
