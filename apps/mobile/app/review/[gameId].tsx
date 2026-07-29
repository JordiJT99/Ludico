import {
  isAttemptReview,
  isCrosswordPublicSolutionPayload,
  isPublicCrosswordGame,
  isPublicQuizGame,
  isPublicSolution,
  isQuizPublicSolutionPayload,
  type AttemptReview,
  type PublicSolution,
} from "@ludico/contracts";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getPlayerHeaders } from "../../src/player-auth";
import { clientPlatform, trackAnalytics } from "../../src/analytics";

type LoadState =
  | { status: "loading" | "locked" | "not_found" | "unavailable" }
  | { review?: AttemptReview; status: "available"; solution: PublicSolution };

export default function ReviewScreen() {
  const { attemptId, gameId } = useLocalSearchParams<{ attemptId?: string; gameId: string }>();
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    if (!gameId) {
      setState({ status: "not_found" });
      return () => controller.abort();
    }
    void loadSolution(gameId, attemptId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setState(result);
    });
    return () => controller.abort();
  }, [attemptId, gameId]);

  useEffect(() => {
    if (state.status !== "available") return;
    void trackAnalytics("ResultViewed", {
      daysAgo: Math.max(
        0,
        Math.floor((Date.now() - Date.parse(state.solution.publishedAt)) / (24 * 60 * 60 * 1_000)),
      ),
      ...(attemptId ? { attemptId } : {}),
      gameId,
      gameType: state.solution.game.type,
      platform: clientPlatform(),
    });
  }, [attemptId, gameId, state]);

  if (state.status === "loading") {
    return (
      <View accessibilityState={{ busy: true }} style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Cargando la revisión" color="#a83242" size="large" />
      </View>
    );
  }

  if (state.status !== "available") {
    return (
      <View style={styles.centered}>
        <Text style={styles.eyebrow}>Revisión diaria</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {state.status === "locked" ? "La solución aún está cerrada" : "Revisión no disponible"}
        </Text>
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          {state.status === "locked"
            ? "Podrás revisar las respuestas cuando termine la edición."
            : "No hemos podido encontrar esta revisión."}
        </Text>
        <Action label="Volver al inicio" onPress={() => router.replace("/")} />
      </View>
    );
  }

  const { solution } = state;
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>Revisión publicada</Text>
      {isPublicQuizGame(solution.game) && isQuizPublicSolutionPayload(solution.payload) ? (
        <QuizReview review={state.review} solution={solution} />
      ) : isPublicCrosswordGame(solution.game) &&
        isCrosswordPublicSolutionPayload(solution.payload) ? (
        <CrosswordReview review={state.review} solution={solution} />
      ) : (
        <Text accessibilityLiveRegion="assertive" style={styles.notice}>
          La revisión publicada no tiene un formato válido.
        </Text>
      )}
      {state.review ? <PersonalReview review={state.review} /> : null}
      <Action label="Volver al inicio" onPress={() => router.replace("/")} />
    </ScrollView>
  );
}

function QuizReview({
  review,
  solution,
}: Readonly<{ review?: AttemptReview; solution: PublicSolution }>) {
  if (!isPublicQuizGame(solution.game) || !isQuizPublicSolutionPayload(solution.payload))
    return null;
  const answers = new Map(solution.payload.questions.map((answer) => [answer.questionId, answer]));
  const percentages = new Map(
    solution.statistics?.quizQuestions?.map((question) => [
      question.questionId,
      question.correctPercent,
    ]),
  );
  const selected = new Map(
    review?.progress.kind === "quiz-progress"
      ? review.progress.answers.map((answer) => [answer.questionId, answer.selectedOptionId])
      : [],
  );
  return (
    <>
      <Text accessibilityRole="header" style={styles.title}>
        {solution.game.payload.title}
      </Text>
      {solution.game.payload.questions.map((question, index) => {
        const answer = answers.get(question.id);
        const correct = question.options.find((option) => option.id === answer?.correctOptionId);
        const chosen = selected.get(question.id);
        return (
          <View key={question.id} style={styles.card}>
            <Text accessibilityRole="header" style={styles.subtitle}>
              {index + 1}. {question.prompt}
            </Text>
            <Text style={styles.answer}>Respuesta: {correct?.text ?? "No disponible"}</Text>
            {review ? (
              <Text style={styles.body}>
                Tu respuesta:{" "}
                {question.options.find((option) => option.id === chosen)?.text ?? "Sin responder"}.{" "}
                {chosen === answer?.correctOptionId ? "Correcta." : "Incorrecta."}
              </Text>
            ) : null}
            {answer ? <Text style={styles.body}>{answer.explanation}</Text> : null}
            {percentages.has(question.id) ? (
              <Text style={styles.body}>
                El {percentages.get(question.id)}% acertó esta pregunta.
              </Text>
            ) : null}
          </View>
        );
      })}
    </>
  );
}

function CrosswordReview({
  review,
  solution,
}: Readonly<{ review?: AttemptReview; solution: PublicSolution }>) {
  if (
    !isPublicCrosswordGame(solution.game) ||
    !isCrosswordPublicSolutionPayload(solution.payload)
  ) {
    return null;
  }
  const answers = new Map(solution.payload.entries.map((entry) => [entry.entryId, entry.answer]));
  const percentages = new Map(
    solution.statistics?.crosswordEntries?.map((entry) => [entry.entryId, entry.incorrectPercent]),
  );
  const cells = new Map(
    review?.progress.kind === "crossword-progress"
      ? review.progress.cells.map((cell) => [cell.cellId, cell.value])
      : [],
  );
  return (
    <>
      <Text accessibilityRole="header" style={styles.title}>
        {solution.game.payload.title}
      </Text>
      {solution.game.payload.entries.map((entry) => (
        <View key={entry.id} style={styles.card}>
          <Text accessibilityRole="header" style={styles.subtitle}>
            {entry.number} {entry.direction === "across" ? "Horizontal" : "Vertical"}. {entry.clue}
          </Text>
          <Text style={styles.answer}>Respuesta: {answers.get(entry.id) ?? "No disponible"}</Text>
          {review ? (
            <Text style={styles.body}>
              Tu respuesta: {entry.cellIds.map((cellId) => cells.get(cellId) ?? "_").join("")}
            </Text>
          ) : null}
          {percentages.has(entry.id) ? (
            <Text style={styles.body}>El {percentages.get(entry.id)}% falló esta palabra.</Text>
          ) : null}
        </View>
      ))}
    </>
  );
}

function PersonalReview({ review }: Readonly<{ review: AttemptReview }>) {
  return (
    <View accessibilityLabel="Tu partida" style={styles.personal}>
      <Text style={styles.eyebrow}>Tu partida</Text>
      <Text accessibilityRole="header" style={styles.subtitle}>
        {review.score.points} puntos
      </Text>
      <Text style={styles.body}>
        {review.score.competitive ? "Partida competitiva" : "Partida casual"}
      </Text>
      {review.progress.kind === "crossword-progress" ? (
        <Text style={styles.body}>Ayudas utilizadas: {review.progress.hintsUsed}</Text>
      ) : (
        <Text style={styles.body}>Respuestas guardadas: {review.progress.answers.length}</Text>
      )}
    </View>
  );
}

function Action({ label, onPress }: Readonly<{ label: string; onPress: () => void }>) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

async function loadSolution(
  gameId: string,
  attemptId: string | undefined,
  signal: AbortSignal,
): Promise<LoadState> {
  try {
    if (attemptId) {
      const headers = await getPlayerHeaders(signal);
      if (headers) {
        const response = await fetch(`${apiUrl()}/attempts/${attemptId}/review`, {
          headers,
          signal,
        });
        if (response.status === 423) return { status: "locked" };
        const body: unknown = await response.json();
        if (response.ok && isAttemptReview(body)) {
          return { review: body, solution: body.solution, status: "available" };
        }
      }
    }
    const response = await fetch(`${apiUrl()}/games/${gameId}/solution`, { signal });
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

function apiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
}

const styles = StyleSheet.create({
  answer: { color: "#17233c", fontSize: 18, fontWeight: "700" },
  body: { color: "#17233c", fontSize: 17, lineHeight: 25 },
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
  card: {
    backgroundColor: "#fff",
    borderColor: "#71809c",
    borderRadius: 10,
    borderWidth: 2,
    gap: 10,
    padding: 16,
  },
  centered: {
    alignItems: "center",
    backgroundColor: "#fff9ef",
    flex: 1,
    gap: 18,
    justifyContent: "center",
    padding: 24,
  },
  container: { backgroundColor: "#fff9ef", flexGrow: 1, gap: 18, padding: 24, paddingTop: 64 },
  eyebrow: { color: "#a83242", fontSize: 16, fontWeight: "700", letterSpacing: 1 },
  notice: { color: "#9b2c2c", fontSize: 17 },
  personal: {
    borderBottomWidth: 2,
    borderColor: "#71809c",
    borderTopWidth: 2,
    gap: 10,
    paddingVertical: 18,
  },
  pressed: { opacity: 0.8 },
  subtitle: { color: "#17233c", fontSize: 20, fontWeight: "700" },
  title: { color: "#17233c", fontSize: 30, fontWeight: "700", textAlign: "center" },
});
