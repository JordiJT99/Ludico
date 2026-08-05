import type { Session } from "@supabase/supabase-js";
import {
  isPlayerProgression,
  isStreakSummary,
  isUserLeaderboardSettings,
  type PlayerProgression,
  type StreakSummary,
} from "@ludico/contracts";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { ensureGuestSession, getStoredGuestSessionCredential } from "../src/guest-session";
import { getAuthClient, getPlayerHeaders, migrateGuestSession } from "../src/player-auth";
import { NotificationSettings } from "../src/notification-settings";
import { clientPlatform, trackAnalytics } from "../src/analytics";

export default function AccountScreen() {
  const router = useRouter();
  const auth = getAuthClient();
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [migrationPending, setMigrationPending] = useState(false);
  const [message, setMessage] = useState("");
  const [alias, setAlias] = useState("");
  const [leaderboardOptIn, setLeaderboardOptIn] = useState(false);
  const [streak, setStreak] = useState<StreakSummary>();
  const [progression, setProgression] = useState<PlayerProgression>();
  const [deletionPassword, setDeletionPassword] = useState("");
  const [deletionConfirmation, setDeletionConfirmation] = useState("");

  useEffect(() => {
    if (!auth) return;
    void auth.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setMigrationPending(Boolean(data.session && (await getStoredGuestSessionCredential())));
    });
    const { data } = auth.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [auth]);

  useEffect(() => {
    if (!session || migrationPending) return;
    const controller = new AbortController();
    void loadProfile(controller.signal).then((profile) => {
      if (!profile) return;
      setStreak(profile.streak);
      setProgression(profile.progression);
      setAlias(profile.settings.alias ?? "");
      setLeaderboardOptIn(profile.settings.leaderboardOptIn);
    });
    return () => controller.abort();
  }, [migrationPending, session]);

  async function submit(action: "sign-in" | "sign-up") {
    if (!auth || pending) return;
    setPending(true);
    setMessage("");
    const result =
      action === "sign-in"
        ? await auth.auth.signInWithPassword({ email, password })
        : await auth.auth.signUp({ email, password });
    if (result.error) {
      setMessage("No se pudo acceder. Revisa los datos e inténtalo de nuevo.");
    } else if (!result.data.session) {
      setMessage("Revisa tu correo para confirmar la cuenta.");
    } else {
      const controller = new AbortController();
      try {
        await migrateGuestSession(result.data.session.access_token, controller.signal);
        setMigrationPending(false);
        setMessage("Cuenta lista. Tu progreso ya viaja contigo.");
        setPassword("");
      } catch {
        setMigrationPending(true);
        setMessage("Has entrado, pero el progreso invitado no pudo migrarse todavía.");
      }
      void trackAnalytics(action === "sign-up" ? "RegistrationCompleted" : "LoginCompleted", {
        entryPoint: "account-screen",
        method: "password",
        outcome: "success",
        platform: clientPlatform(),
      });
    }
    setPending(false);
  }

  async function signOut() {
    if (!auth) return;
    setPending(true);
    await auth.auth.signOut();
    await ensureGuestSession(new AbortController().signal);
    setMessage("Has cerrado sesión. Puedes seguir jugando como invitado.");
    setPending(false);
  }

  async function retryMigration() {
    if (!session) return;
    setPending(true);
    try {
      await migrateGuestSession(session.access_token, new AbortController().signal);
      setMigrationPending(false);
      setMessage("Progreso migrado. Ya puedes continuar en cualquier dispositivo.");
    } catch {
      setMessage("La migración sigue pendiente. Tu progreso invitado permanece guardado.");
    }
    setPending(false);
  }

  async function saveRankingSettings() {
    const controller = new AbortController();
    const headers = await getPlayerHeaders(controller.signal);
    if (!headers) return;
    setPending(true);
    const response = await fetch(`${apiUrl()}/me/leaderboard-settings`, {
      method: "PATCH",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "idempotency-key": Crypto.randomUUID(),
      },
      body: JSON.stringify({ alias: alias.trim() || null, leaderboardOptIn }),
    });
    setMessage(
      response.ok
        ? "Preferencias de clasificación guardadas."
        : "El alias debe tener entre 3 y 24 caracteres.",
    );
    setPending(false);
  }

  async function exportData() {
    if (!session) return;
    setPending(true);
    try {
      const response = await fetch(`${apiUrl()}/me/data-export`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) throw new Error("export");
      await Share.share({ message: await response.text(), title: "Mis datos de Lúdico" });
      setMessage("Copia de tus datos preparada para guardar o compartir.");
    } catch {
      setMessage("No se pudo preparar la copia de tus datos.");
    }
    setPending(false);
  }

  async function deleteAccount() {
    if (!auth || !session?.user.email || pending || deletionConfirmation !== "ELIMINAR") {
      return;
    }
    setPending(true);
    const verified = await auth.auth.signInWithPassword({
      email: session.user.email,
      password: deletionPassword,
    });
    if (verified.error || !verified.data.session) {
      setMessage("No se pudo confirmar tu identidad. Revisa la contraseña.");
      setPending(false);
      return;
    }
    const response = await fetch(`${apiUrl()}/me`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${verified.data.session.access_token}`,
        "Content-Type": "application/json",
        "idempotency-key": Crypto.randomUUID(),
      },
      body: JSON.stringify({ confirmation: deletionConfirmation }),
    });
    if (!response.ok) {
      setMessage("No se pudo eliminar la cuenta. Tus datos no se han modificado.");
      setPending(false);
      return;
    }
    await auth.auth.signOut();
    await ensureGuestSession(new AbortController().signal);
    setDeletionPassword("");
    setDeletionConfirmation("");
    setMessage("Cuenta eliminada. Puedes seguir jugando como invitado.");
    setPending(false);
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>
        Tu cuenta
      </Text>
      {!auth ? (
        <Text style={styles.body}>Las cuentas no están configuradas en este entorno.</Text>
      ) : session ? (
        <View style={styles.form}>
          <Text style={styles.body}>Conectado como {session.user.email}</Text>
          {streak ? (
            <Text style={styles.body}>
              Racha actual: {streak.current} días · Mejor: {streak.best}
            </Text>
          ) : null}
          {progression ? (
            <Text style={styles.body}>
              Nivel {progression.level} · {progression.experience} XP
              {progression.achievements.length
                ? ` · Logros: ${progression.achievements.map((achievement) => (achievement.key === "first-game" ? "Primer reto" : "Doble diario")).join(", ")}`
                : ""}
            </Text>
          ) : null}
          {migrationPending ? (
            <Button
              disabled={pending}
              label="Reintentar migración"
              onPress={() => void retryMigration()}
            />
          ) : null}
          <Text style={styles.label}>Alias público</Text>
          <TextInput
            accessibilityLabel="Alias público"
            maxLength={24}
            onChangeText={setAlias}
            style={styles.input}
            value={alias}
          />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: leaderboardOptIn }}
            onPress={() => setLeaderboardOptIn((value) => !value)}
            style={styles.checkbox}
          >
            <Text style={styles.body}>
              {leaderboardOptIn ? "☑" : "☐"} Mostrar mi alias en la clasificación
            </Text>
          </Pressable>
          <Button
            disabled={pending || (leaderboardOptIn && alias.trim().length < 3)}
            label="Guardar preferencias"
            onPress={() => void saveRankingSettings()}
          />
          <NotificationSettings accessToken={session.access_token} />
          <Text accessibilityRole="header" style={styles.subtitle}>
            Tus datos
          </Text>
          <Button
            disabled={pending}
            label="Guardar una copia de mis datos"
            onPress={() => void exportData()}
          />
          <Text accessibilityRole="header" style={styles.subtitle}>
            Eliminar cuenta
          </Text>
          <Text style={styles.body}>
            Retira tus identificadores, consentimientos, analítica y avisos. No se puede deshacer.
          </Text>
          <Text style={styles.label}>Confirma tu contraseña</Text>
          <TextInput
            accessibilityLabel="Contraseña para eliminar la cuenta"
            autoComplete="current-password"
            onChangeText={setDeletionPassword}
            secureTextEntry
            style={styles.input}
            value={deletionPassword}
          />
          <Text style={styles.label}>Escribe ELIMINAR</Text>
          <TextInput
            accessibilityLabel="Escribe ELIMINAR para confirmar"
            autoCapitalize="characters"
            onChangeText={setDeletionConfirmation}
            style={styles.input}
            value={deletionConfirmation}
          />
          <Button
            disabled={pending || !deletionPassword || deletionConfirmation !== "ELIMINAR"}
            label="Eliminar mi cuenta"
            onPress={() => void deleteAccount()}
          />
          <Button disabled={pending} label="Cerrar sesión" onPress={() => void signOut()} />
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.body}>
            Crea una cuenta para continuar el mismo intento en cualquier dispositivo.
          </Text>
          <Text style={styles.label}>Correo</Text>
          <TextInput
            accessibilityLabel="Correo"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            style={styles.input}
            value={email}
          />
          <Text style={styles.label}>Contraseña</Text>
          <TextInput
            accessibilityLabel="Contraseña"
            autoComplete="current-password"
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            value={password}
          />
          <Button
            disabled={pending || !email || password.length < 8}
            label="Entrar"
            onPress={() => void submit("sign-in")}
          />
          <Button
            disabled={pending || !email || password.length < 8}
            label="Crear cuenta"
            onPress={() => void submit("sign-up")}
          />
        </View>
      )}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          {message}
        </Text>
      ) : null}
      <Button label="Volver" onPress={() => router.back()} />
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
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { color: "#17233c", fontSize: 17, lineHeight: 24 },
  button: {
    alignItems: "center",
    backgroundColor: "#17233c",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  buttonText: { color: "#fff9ef", fontSize: 18, fontWeight: "700" },
  checkbox: { minHeight: 48, justifyContent: "center" },
  container: { backgroundColor: "#fff9ef", flexGrow: 1, gap: 20, padding: 24, paddingTop: 64 },
  disabled: { opacity: 0.55 },
  form: { gap: 12 },
  input: {
    backgroundColor: "#fff",
    borderColor: "#71809c",
    borderRadius: 8,
    borderWidth: 2,
    color: "#17233c",
    fontSize: 18,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  label: { color: "#17233c", fontSize: 16, fontWeight: "700" },
  subtitle: { color: "#17233c", fontSize: 22, fontWeight: "700", marginTop: 8 },
  title: { color: "#17233c", fontSize: 32, fontWeight: "700" },
});

async function loadProfile(signal: AbortSignal) {
  const headers = await getPlayerHeaders(signal);
  if (!headers) return null;
  const [streakResponse, settingsResponse, progressionResponse] = await Promise.all([
    fetch(`${apiUrl()}/me/streaks`, { headers, signal }),
    fetch(`${apiUrl()}/me/leaderboard-settings`, { headers, signal }),
    fetch(`${apiUrl()}/me/achievements`, { headers, signal }),
  ]);
  const streak: unknown = await streakResponse.json();
  const settings: unknown = await settingsResponse.json();
  const progression: unknown = await progressionResponse.json();
  return streakResponse.ok &&
    settingsResponse.ok &&
    progressionResponse.ok &&
    isStreakSummary(streak) &&
    isUserLeaderboardSettings(settings) &&
    isPlayerProgression(progression)
    ? { progression, settings, streak }
    : null;
}

function apiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
}
