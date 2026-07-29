import {
  isCrosswordAttemptState,
  isCrosswordHintResult,
  isCrosswordProgressConflict,
  isCrosswordProgressSaved,
  isCrosswordSubmitResult,
  isPublicCrosswordGame,
  type CrosswordAttemptState,
  type CrosswordEntryPublic,
  type CrosswordLocalDraft,
  type CrosswordProgressEvent,
  type CrosswordPublicPayload,
  type CrosswordSubmitResult,
} from "@ludico/contracts";
import { normalizeCrosswordLetter } from "@ludico/domain/crossword";
import {
  applyCrosswordEvents,
  synchronizeCrosswordProgress,
} from "@ludico/domain/crossword-progress";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  readCrosswordDraft,
  removeCrosswordDraft,
  writeCrosswordDraft,
} from "../../src/crossword-storage";
import { getPlayerHeaders, type PlayerHeaders } from "../../src/player-auth";
import { LeaderboardPanel } from "../../src/leaderboard-panel";
import { ShareButton } from "../../src/share-button";
import { clientPlatform, durationBucket, scoreBucket, trackAnalytics } from "../../src/analytics";

type PlayingState = {
  activeCellId: string;
  activeEntryId: string;
  attempt: CrosswordAttemptState;
  contentVersion: number;
  crossword: CrosswordPublicPayload;
  headers: PlayerHeaders;
};

type SessionState = {
  pendingEvents: readonly CrosswordProgressEvent[];
  playing: PlayingState;
  syncStatus: "saved" | "syncing" | "pending";
};

const cellSize = 48;

export default function CrosswordScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SessionState>();
  const [result, setResult] = useState<CrosswordSubmitResult>();
  const [fatalError, setFatalError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);
  const [confirmHint, setConfirmHint] = useState(false);
  const changedAt = useRef(0);
  const startedAt = useRef(0);
  const sessionRef = useRef<SessionState | undefined>(undefined);
  const syncingRef = useRef(false);

  const updateSession = useCallback((state: SessionState) => {
    sessionRef.current = state;
    setSession(state);
  }, []);

  const sync = useCallback(async () => {
    const snapshot = sessionRef.current;
    if (!snapshot?.pendingEvents.length || syncingRef.current) return;
    syncingRef.current = true;
    const sentEventIds = new Set(snapshot.pendingEvents.map((event) => event.clientEventId));
    updateSession({ ...snapshot, syncStatus: "syncing" });
    let synchronized = false;
    try {
      const saved = await sendPending(snapshot);
      const latest = sessionRef.current ?? snapshot;
      const pendingEvents = latest.pendingEvents.filter(
        (event) => !sentEventIds.has(event.clientEventId),
      );
      updateSession({
        pendingEvents,
        playing: {
          ...latest.playing,
          attempt: applyCrosswordEvents(saved.playing.attempt, pendingEvents),
        },
        syncStatus: pendingEvents.length ? "syncing" : "saved",
      });
      setNotice(undefined);
      synchronized = true;
    } catch {
      const latest = sessionRef.current ?? snapshot;
      updateSession({ ...latest, syncStatus: "pending" });
      setNotice("Sin conexión. Las letras quedan pendientes en este dispositivo.");
    } finally {
      syncingRef.current = false;
      if (synchronized && sessionRef.current?.pendingEvents.length) void sync();
    }
  }, [updateSession]);

  useEffect(() => {
    const controller = new AbortController();
    if (!gameId) {
      setFatalError("El juego no es válido.");
      return () => controller.abort();
    }
    void start(gameId, controller.signal)
      .then(async (state) => {
        startedAt.current = Date.now();
        changedAt.current = performance.now();
        if (state.playing.attempt.result) {
          await removeCrosswordDraft(gameId);
          setResult(state.playing.attempt.result);
          return;
        }
        void trackAnalytics("GameStarted", {
          attemptId: state.playing.attempt.attemptId,
          entryPoint: state.playing.attempt.cells.length ? "resume" : "daily",
          gameId,
          gameType: "crossword",
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
        updateSession(state);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFatalError("Este crucigrama no se ha descargado todavía y ahora no hay conexión.");
        }
      });
    return () => controller.abort();
  }, [gameId, updateSession]);

  useEffect(() => {
    if (session && gameId)
      void writeCrosswordDraft(toDraft(gameId, session)).catch(() => undefined);
  }, [gameId, session]);

  useEffect(() => {
    const subscription = Network.addNetworkStateListener((state) => {
      if (state.isConnected) void sync();
    });
    return () => subscription.remove();
  }, [sync]);

  if (fatalError) {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="header" style={styles.title}>
          No hemos podido abrir el crucigrama
        </Text>
        <Text accessibilityLiveRegion="assertive" style={styles.notice}>
          {fatalError}
        </Text>
        <Button label="Volver al inicio" onPress={() => router.replace("/")} />
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
          {result.provisional.completed ? "Crucigrama completado. " : "Crucigrama enviado. "}
          {result.competitive ? "Tu puntuación entra en la clasificación." : "Partida casual."}
        </Text>
        <Text style={styles.body}>
          La solución y las diferencias estarán disponibles al cerrar la edición.
        </Text>
        {gameId ? <LeaderboardPanel gameId={gameId} /> : null}
        <ShareButton attemptId={result.attemptId} />
        <Button
          label="Ver revisión al cierre"
          onPress={() => router.push(`/review/${gameId}?attemptId=${result.attemptId}`)}
        />
        <Button label="Volver al inicio" onPress={() => router.replace("/")} />
      </View>
    );
  }
  if (!session) {
    return (
      <View accessibilityState={{ busy: true }} style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Preparando la cuadrícula" color="#a83242" />
      </View>
    );
  }

  const { playing } = session;
  const activeEntry = entryById(playing.crossword, playing.activeEntryId);
  const values = new Map(playing.attempt.cells.map((cell) => [cell.cellId, cell.value]));
  const filled = playing.crossword.cells.filter((cell) => values.has(cell.id)).length;

  function selectCell(cellId: string) {
    const current = sessionRef.current;
    if (!current || saving) return;
    const entries = entriesForCell(current.playing.crossword, cellId);
    const currentIndex = entries.findIndex((entry) => entry.id === current.playing.activeEntryId);
    const entry =
      entries[currentIndex >= 0 && entries.length > 1 ? (currentIndex + 1) % entries.length : 0];
    if (!entry) return;
    updateSession({
      ...current,
      playing: { ...current.playing, activeCellId: cellId, activeEntryId: entry.id },
    });
  }

  function selectEntryCell(entryId: string, cellId: string) {
    const current = sessionRef.current;
    if (!current || saving) return;
    updateSession({
      ...current,
      playing: { ...current.playing, activeCellId: cellId, activeEntryId: entryId },
    });
  }

  async function writeCell(entry: CrosswordEntryPublic, cellId: string, rawValue: string) {
    const current = sessionRef.current;
    if (!current || saving) return;
    const value = rawValue === "" ? "" : normalizeCrosswordLetter(rawValue);
    if (value === null) {
      setNotice("Introduce una sola letra. La Ñ se conserva y las tildes se aceptan.");
      return;
    }
    const event: CrosswordProgressEvent = {
      cellId,
      clientEventId: Crypto.randomUUID(),
      clientOccurredAt: new Date().toISOString(),
      elapsedMs: Math.max(0, Math.round(performance.now() - changedAt.current)),
      value,
    };
    const nextCellId = nextCell(entry, cellId);
    const nextEntry = preferredEntry(current.playing.crossword, nextCellId, entry.id);
    const next: SessionState = {
      pendingEvents: [...current.pendingEvents, event],
      playing: {
        ...current.playing,
        activeCellId: nextCellId,
        activeEntryId: nextEntry.id,
        attempt: applyCrosswordEvents(current.playing.attempt, [event]),
      },
      syncStatus: "syncing",
    };
    changedAt.current = performance.now();
    setConfirmIncomplete(false);
    updateSession(next);
    await sync();
  }

  async function submit() {
    const current = sessionRef.current;
    if (!current || saving || syncingRef.current) return;
    if (filled < playing.crossword.cells.length && !confirmIncomplete) {
      setConfirmIncomplete(true);
      setNotice(
        `Quedan ${playing.crossword.cells.length - filled} celdas vacías. Pulsa Finalizar otra vez para enviar.`,
      );
      return;
    }
    setSaving(true);
    let ready = current;
    try {
      if (ready.pendingEvents.length) ready = await sendPending(ready);
      const response = await fetch(
        `${apiUrl()}/attempts/${ready.playing.attempt.attemptId}/submit`,
        { method: "POST", headers: commandHeaders(ready.playing.headers) },
      );
      const body: unknown = await response.json();
      if (!response.ok || !isCrosswordSubmitResult(body)) throw new Error("submit");
      if (gameId) await removeCrosswordDraft(gameId);
      setResult(body);
      void trackAnalytics("GameCompleted", {
        aidsCount: ready.playing.attempt.hintsUsed,
        attemptId: body.attemptId,
        competitive: body.competitive,
        durationBucket: durationBucket(Date.now() - startedAt.current),
        gameType: "crossword",
        gameId,
        scoreBucket: scoreBucket(body.provisional.score),
      });
      setNotice(undefined);
    } catch {
      updateSession({ ...ready, syncStatus: ready.pendingEvents.length ? "pending" : "saved" });
      setNotice("No se pudo finalizar. Las letras siguen guardadas en este dispositivo.");
    } finally {
      setSaving(false);
    }
  }

  async function revealActiveCell() {
    const current = sessionRef.current;
    if (!current || saving || syncingRef.current) return;
    if (!confirmHint) {
      setConfirmHint(true);
      setNotice(
        "Esta ayuda revela una letra y convierte el intento en casual. Pulsa Revelar letra otra vez para continuar.",
      );
      return;
    }
    setSaving(true);
    let ready = current;
    try {
      if (ready.pendingEvents.length) ready = await sendPending(ready);
      const response = await fetch(
        `${apiUrl()}/attempts/${ready.playing.attempt.attemptId}/hints`,
        {
          method: "POST",
          headers: commandHeaders(ready.playing.headers),
          body: JSON.stringify({
            cellId: ready.playing.activeCellId,
            clientEventId: Crypto.randomUUID(),
          }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok || !isCrosswordHintResult(body)) throw new Error("hint");
      const cells = new Map(ready.playing.attempt.cells.map((cell) => [cell.cellId, cell]));
      cells.set(body.cellId, { cellId: body.cellId, elapsedMs: 0, value: body.value });
      updateSession({
        pendingEvents: [],
        playing: {
          ...ready.playing,
          attempt: {
            ...ready.playing.attempt,
            cells: [...cells.values()],
            hintsUsed: body.hintsUsed,
            version: body.version,
          },
        },
        syncStatus: "saved",
      });
      setConfirmHint(false);
      setNotice("Letra revelada. Este intento ya es casual y no entra en la clasificación.");
    } catch {
      updateSession(ready);
      setNotice("La ayuda necesita conexión. Tus letras siguen guardadas.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>{playing.crossword.title}</Text>
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
        {filled} de {playing.crossword.cells.length} celdas · {directionLabel(activeEntry)}{" "}
        {activeEntry.number}
      </Text>
      <Text accessibilityRole="header" style={styles.title}>
        {activeEntry.clue}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View
          accessibilityLabel="Cuadrícula del crucigrama"
          accessibilityRole="summary"
          style={{ width: playing.crossword.columns * cellSize }}
        >
          {Array.from({ length: playing.crossword.rows }, (_, row) => (
            <View key={row} style={styles.gridRow}>
              {Array.from({ length: playing.crossword.columns }, (_, column) => {
                const cell = playing.crossword.cells.find(
                  (candidate) => candidate.row === row && candidate.column === column,
                );
                if (!cell) return <View key={`${row}:${column}`} style={styles.block} />;
                const value = values.get(cell.id) ?? "";
                const cellEntries = entriesForCell(playing.crossword, cell.id);
                return (
                  <Pressable
                    accessibilityLabel={`Fila ${row + 1}, columna ${column + 1}${cell.number ? `, número ${cell.number}` : ""}, ${cellEntries.map(directionLabel).join(" y ")}, ${value ? `letra ${value}` : "vacía"}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: cell.id === playing.activeCellId }}
                    key={cell.id}
                    onPress={() => selectCell(cell.id)}
                    style={[styles.cell, cell.id === playing.activeCellId && styles.cellActive]}
                  >
                    {cell.number ? <Text style={styles.cellNumber}>{cell.number}</Text> : null}
                    <Text style={styles.cellLetter}>{value}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <View accessibilityLabel="Pistas y campos accesibles" style={styles.clues}>
        <Text accessibilityRole="header" style={styles.subtitle}>
          Pistas y campos accesibles
        </Text>
        {playing.crossword.entries.map((entry) => (
          <View key={entry.id} style={styles.clueField}>
            <Text style={styles.clueText}>
              {entry.number} {directionLabel(entry)}. {entry.clue}
            </Text>
            <View style={styles.letterFields}>
              {entry.cellIds.map((cellId, index) => (
                <TextInput
                  accessibilityLabel={`Letra ${index + 1} de ${entry.cellIds.length}, ${entry.number} ${directionLabel(entry)}. ${entry.clue}`}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  key={cellId}
                  maxLength={2}
                  onChangeText={(value) => void writeCell(entry, cellId, value)}
                  onFocus={() => selectEntryCell(entry.id, cellId)}
                  style={[
                    styles.input,
                    entry.id === playing.activeEntryId && cellId === playing.activeCellId
                      ? styles.inputActive
                      : null,
                  ]}
                  value={values.get(cellId) ?? ""}
                />
              ))}
            </View>
          </View>
        ))}
      </View>

      {session.syncStatus === "pending" ? (
        <Button disabled={saving} label="Sincronizar" onPress={() => void sync()} />
      ) : null}
      <Button
        disabled={saving || session.syncStatus === "syncing"}
        label="Revelar letra · partida casual"
        onPress={() => void revealActiveCell()}
      />
      <Button
        disabled={saving || session.syncStatus === "syncing"}
        label="Comprobar formato"
        onPress={() =>
          setNotice(
            filled === playing.crossword.cells.length
              ? "Todas las celdas tienen un formato válido. La corrección llegará tras el cierre."
              : `Quedan ${playing.crossword.cells.length - filled} celdas vacías.`,
          )
        }
      />
      <Button
        disabled={saving}
        label={saving ? "Guardando…" : "Finalizar"}
        onPress={() => void submit()}
      />
    </ScrollView>
  );
}

function Button({
  disabled = false,
  label,
  onPress,
}: Readonly<{ disabled?: boolean; label: string; onPress: () => void }>) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

async function start(gameId: string, signal: AbortSignal): Promise<SessionState> {
  const [headers, cached] = await Promise.all([
    getPlayerHeaders(signal),
    readCrosswordDraft(gameId),
  ]);
  if (!headers) throw new Error("guest");
  try {
    const gameResponse = await fetch(`${apiUrl()}/games/${gameId}`, { signal });
    if (!gameResponse.ok) throw new Error(gameResponse.status === 404 ? "game" : "offline");
    const game: unknown = await gameResponse.json();
    if (!isPublicCrosswordGame(game)) throw new Error("game");
    const attemptResponse = await fetch(`${apiUrl()}/games/${gameId}/attempts`, {
      method: "POST",
      headers: commandHeaders(headers),
      signal,
    });
    if (!attemptResponse.ok) throw new Error("offline");
    const attempt: unknown = await attemptResponse.json();
    if (!isCrosswordAttemptState(attempt)) throw new Error("attempt");
    const cacheMatches =
      cached?.attempt.attemptId === attempt.attemptId &&
      cached.contentVersion === game.contentVersion;
    const pendingEvents = cacheMatches ? cached.pendingEvents : [];
    const selection = validSelection(
      game.payload,
      cacheMatches ? cached.activeCellId : undefined,
      cacheMatches ? cached.activeEntryId : undefined,
    );
    return {
      pendingEvents,
      playing: {
        ...selection,
        attempt: applyCrosswordEvents(attempt, pendingEvents),
        contentVersion: game.contentVersion,
        crossword: game.payload,
        headers,
      },
      syncStatus: pendingEvents.length ? "pending" : "saved",
    };
  } catch (cause) {
    if (cause instanceof Error && cause.message === "game") throw cause;
    if (!cached) throw cause;
    return {
      pendingEvents: cached.pendingEvents,
      playing: {
        activeCellId: cached.activeCellId,
        activeEntryId: cached.activeEntryId,
        attempt: cached.attempt,
        contentVersion: cached.contentVersion,
        crossword: cached.crossword,
        headers,
      },
      syncStatus: cached.pendingEvents.length ? "pending" : "saved",
    };
  }
}

async function sendPending(session: SessionState): Promise<SessionState> {
  if (!session.pendingEvents.length) return { ...session, syncStatus: "saved" };
  const attempt = await synchronizeCrosswordProgress(
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
      if (response.status === 409 && isCrosswordProgressConflict(body)) return body;
      if (!response.ok || !isCrosswordProgressSaved(body)) throw new Error("sync");
      return body;
    },
  );
  return {
    pendingEvents: [],
    playing: { ...session.playing, attempt },
    syncStatus: "saved",
  };
}

function toDraft(gameId: string, session: SessionState): CrosswordLocalDraft {
  return {
    activeCellId: session.playing.activeCellId,
    activeEntryId: session.playing.activeEntryId,
    attempt: session.playing.attempt,
    contentVersion: session.playing.contentVersion,
    crossword: session.playing.crossword,
    gameId,
    pendingEvents: session.pendingEvents,
    savedAt: new Date().toISOString(),
  };
}

function validSelection(crossword: CrosswordPublicPayload, cellId?: string, entryId?: string) {
  const entry = crossword.entries.find(
    (candidate) => candidate.id === entryId && candidate.cellIds.includes(cellId ?? ""),
  );
  if (entry && cellId) return { activeCellId: cellId, activeEntryId: entry.id };
  const first = crossword.entries[0]!;
  return { activeCellId: first.cellIds[0]!, activeEntryId: first.id };
}

function entryById(crossword: CrosswordPublicPayload, entryId: string) {
  return crossword.entries.find((entry) => entry.id === entryId) ?? crossword.entries[0]!;
}

function entriesForCell(crossword: CrosswordPublicPayload, cellId: string) {
  return crossword.entries.filter((entry) => entry.cellIds.includes(cellId));
}

function preferredEntry(crossword: CrosswordPublicPayload, cellId: string, entryId: string) {
  const entries = entriesForCell(crossword, cellId);
  return entries.find((entry) => entry.id === entryId) ?? entries[0]!;
}

function nextCell(entry: CrosswordEntryPublic, cellId: string): string {
  const index = entry.cellIds.indexOf(cellId);
  return entry.cellIds[Math.min(index + 1, entry.cellIds.length - 1)]!;
}

function directionLabel(entry: CrosswordEntryPublic) {
  return entry.direction === "across" ? "Horizontal" : "Vertical";
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
  block: { backgroundColor: "#17233c", height: cellSize, width: cellSize },
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
  cell: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderColor: "#17233c",
    borderWidth: 1,
    height: cellSize,
    justifyContent: "center",
    position: "relative",
    width: cellSize,
  },
  cellActive: { backgroundColor: "#f6d79a", borderColor: "#a83242", borderWidth: 3 },
  cellLetter: { color: "#17233c", fontSize: 24, fontWeight: "800" },
  cellNumber: {
    color: "#17233c",
    fontSize: 9,
    fontWeight: "700",
    left: 2,
    position: "absolute",
    top: 2,
  },
  centered: {
    alignItems: "center",
    backgroundColor: "#fff9ef",
    flex: 1,
    gap: 18,
    justifyContent: "center",
    padding: 24,
  },
  clueField: { gap: 8 },
  clueText: { color: "#17233c", fontSize: 17 },
  clues: { gap: 18 },
  container: { backgroundColor: "#fff9ef", flexGrow: 1, gap: 18, padding: 24, paddingTop: 64 },
  disabled: { opacity: 0.55 },
  eyebrow: { color: "#a83242", fontSize: 16, fontWeight: "700", letterSpacing: 1 },
  gridRow: { flexDirection: "row" },
  input: {
    backgroundColor: "#fff",
    borderColor: "#71809c",
    borderRadius: 8,
    borderWidth: 2,
    color: "#17233c",
    fontSize: 20,
    height: 48,
    paddingHorizontal: 4,
    textAlign: "center",
    width: 48,
  },
  inputActive: { borderColor: "#a83242" },
  letterFields: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  notice: { color: "#9b2c2c", fontSize: 16 },
  pressed: { opacity: 0.8 },
  progress: { color: "#40506d", fontSize: 16 },
  score: { color: "#17233c", fontSize: 48, fontWeight: "700", textAlign: "center" },
  subtitle: { color: "#17233c", fontSize: 22, fontWeight: "700" },
  syncStatus: { color: "#40506d", fontSize: 16, fontWeight: "700" },
  title: { color: "#17233c", fontSize: 30, fontWeight: "700" },
});
