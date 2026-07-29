import { isNotificationPreferences, type NotificationPreferences } from "@ludico/contracts";
import * as Crypto from "expo-crypto";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export function NotificationSettings({ accessToken }: Readonly<{ accessToken: string }>) {
  const [preferences, setPreferences] = useState<NotificationPreferences>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiUrl()}/me/notification-preferences`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (response.ok && isNotificationPreferences(body)) setPreferences(body);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [accessToken]);

  if (!preferences) return null;

  async function save(next = preferences) {
    if (!next || pending) return;
    setPending(true);
    setMessage("");
    try {
      if (next.enabled && !preferences?.enabled) await registerDevice(accessToken);
      const response = await fetch(`${apiUrl()}/me/notification-preferences`, {
        body: JSON.stringify(next),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "idempotency-key": Crypto.randomUUID(),
        },
        method: "PATCH",
      });
      const body: unknown = await response.json();
      if (!response.ok || !isNotificationPreferences(body)) throw new Error("save");
      setPreferences(body);
      setMessage(body.enabled ? "Notificaciones activadas." : "Notificaciones desactivadas.");
    } catch (error) {
      setPreferences((current) => (current ? { ...current, enabled: false } : current));
      setMessage(notificationErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        Notificaciones
      </Text>
      <Text style={styles.body}>Como máximo una al día y tres por semana.</Text>
      <Choice
        checked={preferences.enabled}
        label="Recibir recordatorios"
        onPress={() => void save({ ...preferences, enabled: !preferences.enabled })}
      />
      <Choice
        checked={preferences.editionAvailable}
        label="Nueva edición disponible"
        onPress={() =>
          setPreferences({ ...preferences, editionAvailable: !preferences.editionAvailable })
        }
      />
      <Choice
        checked={preferences.previousSolution}
        label="Solución del día anterior"
        onPress={() =>
          setPreferences({ ...preferences, previousSolution: !preferences.previousSolution })
        }
      />
      <Text style={styles.label}>Zona horaria</Text>
      <TextInput
        accessibilityLabel="Zona horaria"
        autoCapitalize="none"
        onChangeText={(timeZone) => setPreferences({ ...preferences, timeZone })}
        style={styles.input}
        value={preferences.timeZone}
      />
      <View style={styles.times}>
        <View style={styles.timeField}>
          <Text style={styles.label}>Silencio desde</Text>
          <TextInput
            accessibilityLabel="Silencio desde"
            onChangeText={(quietStart) => setPreferences({ ...preferences, quietStart })}
            placeholder="22:00"
            style={styles.input}
            value={preferences.quietStart}
          />
        </View>
        <View style={styles.timeField}>
          <Text style={styles.label}>Hasta</Text>
          <TextInput
            accessibilityLabel="Silencio hasta"
            onChangeText={(quietEnd) => setPreferences({ ...preferences, quietEnd })}
            placeholder="08:00"
            style={styles.input}
            value={preferences.quietEnd}
          />
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={
          pending ||
          (preferences.enabled && !preferences.editionAvailable && !preferences.previousSolution)
        }
        onPress={() => void save()}
        style={[styles.button, pending && styles.disabled]}
      >
        <Text style={styles.buttonText}>Guardar notificaciones</Text>
      </Pressable>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

function Choice({
  checked,
  label,
  onPress,
}: Readonly<{ checked: boolean; label: string; onPress: () => void }>) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={styles.choice}
    >
      <Text style={styles.body}>
        {checked ? "☑" : "☐"} {label}
      </Text>
    </Pressable>
  );
}

async function registerDevice(accessToken: string): Promise<void> {
  if (process.env.EXPO_PUBLIC_PUSH_ENABLED !== "true") throw new Error("disabled");
  if (Platform.OS !== "android" && Platform.OS !== "ios") throw new Error("device");
  const [{ default: Device }, Notifications] = await Promise.all([
    import("expo-device"),
    import("expo-notifications"),
  ]);
  if (!Device.isDevice) throw new Error("device");
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("daily", {
      importance: Notifications.AndroidImportance.DEFAULT,
      name: "Retos diarios",
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const permission =
    current.status === "granted" ? current : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") throw new Error("permission");
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) throw new Error("project");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const response = await fetch(`${apiUrl()}/devices/push-token`, {
    body: JSON.stringify({ platform: Platform.OS, token }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "idempotency-key": Crypto.randomUUID(),
    },
    method: "POST",
  });
  if (!response.ok) throw new Error("register");
}

function notificationErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "unknown";
  if (code === "permission") return "Permiso denegado. Puedes activarlo más tarde desde Ajustes.";
  if (code === "device") return "Las notificaciones push requieren un dispositivo físico.";
  if (code === "disabled" || code === "project") {
    return "Las notificaciones no están disponibles en este entorno.";
  }
  return "No se pudieron guardar las notificaciones. Inténtalo de nuevo.";
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
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  buttonText: { color: "#fff9ef", fontSize: 18, fontWeight: "700" },
  choice: { justifyContent: "center", minHeight: 48 },
  disabled: { opacity: 0.55 },
  heading: { color: "#17233c", fontSize: 24, fontWeight: "700" },
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
  section: { gap: 12 },
  timeField: { flex: 1, gap: 6 },
  times: { flexDirection: "row", gap: 12 },
});
