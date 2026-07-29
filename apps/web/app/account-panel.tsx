"use client";

import {
  isNotificationPreferences,
  isStreakSummary,
  isUserLeaderboardSettings,
  type NotificationPreferences,
  type StreakSummary,
} from "@ludico/contracts";
import { useEffect, useState, type SyntheticEvent } from "react";
import { trackAnalytics } from "./analytics";

export function AccountPanel() {
  const [configured, setConfigured] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [alias, setAlias] = useState("");
  const [leaderboardOptIn, setLeaderboardOptIn] = useState(false);
  const [streak, setStreak] = useState<StreakSummary>();
  const [notifications, setNotifications] = useState<NotificationPreferences>();
  const [deletionPassword, setDeletionPassword] = useState("");
  const [deletionConfirmation, setDeletionConfirmation] = useState("");

  useEffect(() => {
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((state: { configured?: boolean; email?: string | null }) => {
        setConfigured(state.configured === true);
        setSessionEmail(state.email ?? null);
      });
  }, []);

  useEffect(() => {
    if (!sessionEmail) return;
    void Promise.all([
      fetch("/api/player/me/streaks", { cache: "no-store" }),
      fetch("/api/player/me/leaderboard-settings", { cache: "no-store" }),
      fetch("/api/player/me/notification-preferences", { cache: "no-store" }),
    ]).then(async ([streakResponse, settingsResponse, notificationResponse]) => {
      const streakBody: unknown = await streakResponse.json();
      const settingsBody: unknown = await settingsResponse.json();
      const notificationBody: unknown = await notificationResponse.json();
      if (streakResponse.ok && isStreakSummary(streakBody)) setStreak(streakBody);
      if (settingsResponse.ok && isUserLeaderboardSettings(settingsBody)) {
        setAlias(settingsBody.alias ?? "");
        setLeaderboardOptIn(settingsBody.leaderboardOptIn);
      }
      if (notificationResponse.ok && isNotificationPreferences(notificationBody)) {
        setNotifications(notificationBody);
      }
    });
  }, [sessionEmail]);

  if (!configured) return null;

  async function submit(event: SyntheticEvent, action: "sign-in" | "sign-up") {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      await fetch("/api/guest-session", { method: "POST" });
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email, password }),
      });
      const result = (await response.json()) as {
        email?: string;
        migration?: "migrated" | "not_needed" | "pending";
        status?: string;
      };
      if (response.status === 202) {
        setMessage("Revisa tu correo para confirmar la cuenta.");
      } else if (!response.ok || result.status !== "authenticated") {
        setMessage("No se pudo acceder. Revisa los datos e inténtalo de nuevo.");
      } else {
        setSessionEmail(result.email ?? email);
        void trackAnalytics(action === "sign-up" ? "RegistrationCompleted" : "LoginCompleted", {
          entryPoint: "account-panel",
          method: "password",
          outcome: "success",
          platform: "web",
        });
        window.dispatchEvent(new Event("ludico:account-changed"));
        setMessage(
          result.migration === "pending"
            ? "Has entrado, pero el progreso invitado no pudo migrarse todavía."
            : "Cuenta lista. Tu progreso ya viaja contigo.",
        );
        setPassword("");
      }
    } catch {
      setMessage("No se pudo acceder. Inténtalo de nuevo cuando tengas conexión.");
    }
    setPending(false);
  }

  async function signOut() {
    setPending(true);
    await fetch("/api/auth/session", { method: "DELETE" });
    await fetch("/api/guest-session", { method: "POST" });
    setSessionEmail(null);
    window.dispatchEvent(new Event("ludico:account-changed"));
    setMessage("Has cerrado sesión. Puedes seguir jugando como invitado.");
    setPending(false);
  }

  async function deleteAccount(event: SyntheticEvent) {
    event.preventDefault();
    if (!sessionEmail || deletionConfirmation !== "ELIMINAR") return;
    setPending(true);
    setMessage("");
    const reauthentication = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sign-in",
        email: sessionEmail,
        password: deletionPassword,
      }),
    });
    if (!reauthentication.ok) {
      setMessage("No se pudo confirmar tu identidad. Revisa la contraseña.");
      setPending(false);
      return;
    }
    const response = await fetch("/api/player/me", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: deletionConfirmation }),
    });
    if (!response.ok) {
      setMessage("No se pudo eliminar la cuenta. Tus datos no se han modificado.");
      setPending(false);
      return;
    }
    await fetch("/api/auth/session", { method: "DELETE" });
    await fetch("/api/guest-session", { method: "POST" });
    setSessionEmail(null);
    setDeletionPassword("");
    setDeletionConfirmation("");
    window.dispatchEvent(new Event("ludico:account-changed"));
    setMessage("Cuenta eliminada. Puedes seguir jugando como invitado.");
    setPending(false);
  }

  async function saveRankingSettings(event: SyntheticEvent) {
    event.preventDefault();
    setPending(true);
    const response = await fetch("/api/player/me/leaderboard-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias: alias.trim() || null, leaderboardOptIn }),
    });
    setMessage(
      response.ok
        ? "Preferencias de clasificación guardadas."
        : "No se pudieron guardar. El alias debe tener entre 3 y 24 caracteres.",
    );
    setPending(false);
  }

  async function saveNotificationSettings(event: SyntheticEvent) {
    event.preventDefault();
    if (!notifications) return;
    setPending(true);
    const response = await fetch("/api/player/me/notification-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(notifications),
    });
    setMessage(
      response.ok
        ? "Preferencias de avisos guardadas."
        : "No se pudieron guardar las preferencias de avisos.",
    );
    setPending(false);
  }

  return (
    <aside aria-labelledby="account-heading" className="account-panel">
      <h2 id="account-heading">Tu cuenta</h2>
      {sessionEmail ? (
        <>
          <p>Conectado como {sessionEmail}</p>
          {streak ? (
            <p>
              Racha actual: <strong>{streak.current}</strong> días · Mejor: {streak.best}
            </p>
          ) : null}
          <form className="account-form" onSubmit={saveRankingSettings}>
            <label>
              Alias público
              <input
                maxLength={24}
                minLength={3}
                onChange={(event) => setAlias(event.target.value)}
                required={leaderboardOptIn}
                value={alias}
              />
            </label>
            <label className="checkbox-label">
              <input
                checked={leaderboardOptIn}
                onChange={(event) => setLeaderboardOptIn(event.target.checked)}
                type="checkbox"
              />
              Mostrar mi alias en la clasificación
            </label>
            <button disabled={pending} type="submit">
              Guardar preferencias
            </button>
          </form>
          {notifications ? (
            <form className="account-form" onSubmit={saveNotificationSettings}>
              <h3>Avisos de la app</h3>
              <p>El permiso y el dispositivo push se activan desde la app móvil.</p>
              <label className="checkbox-label">
                <input
                  checked={notifications.enabled}
                  onChange={(event) =>
                    setNotifications({ ...notifications, enabled: event.target.checked })
                  }
                  type="checkbox"
                />
                Avisos activados
              </label>
              <label className="checkbox-label">
                <input
                  checked={notifications.editionAvailable}
                  onChange={(event) =>
                    setNotifications({ ...notifications, editionAvailable: event.target.checked })
                  }
                  type="checkbox"
                />
                Edición disponible
              </label>
              <label className="checkbox-label">
                <input
                  checked={notifications.previousSolution}
                  onChange={(event) =>
                    setNotifications({ ...notifications, previousSolution: event.target.checked })
                  }
                  type="checkbox"
                />
                Solución anterior disponible
              </label>
              <label>
                Zona horaria
                <input
                  maxLength={64}
                  onChange={(event) =>
                    setNotifications({ ...notifications, timeZone: event.target.value })
                  }
                  value={notifications.timeZone}
                />
              </label>
              <div className="account-actions">
                <label>
                  Silencio desde
                  <input
                    onChange={(event) =>
                      setNotifications({ ...notifications, quietStart: event.target.value })
                    }
                    type="time"
                    value={notifications.quietStart}
                  />
                </label>
                <label>
                  hasta
                  <input
                    onChange={(event) =>
                      setNotifications({ ...notifications, quietEnd: event.target.value })
                    }
                    type="time"
                    value={notifications.quietEnd}
                  />
                </label>
              </div>
              <button disabled={pending} type="submit">
                Guardar avisos
              </button>
            </form>
          ) : null}
          <div className="account-form">
            <h3>Tus datos</h3>
            <p>Descarga una copia JSON de tu perfil, partidas, consentimientos y analítica.</p>
            <a download href="/api/player/me/data-export">
              Descargar mis datos
            </a>
          </div>
          <form className="account-form" onSubmit={deleteAccount}>
            <h3>Eliminar cuenta</h3>
            <p>
              Esta acción retira tus identificadores, consentimientos, analítica y avisos. No se
              puede deshacer.
            </p>
            <label>
              Confirma tu contraseña
              <input
                autoComplete="current-password"
                onChange={(event) => setDeletionPassword(event.target.value)}
                required
                type="password"
                value={deletionPassword}
              />
            </label>
            <label>
              Escribe ELIMINAR
              <input
                onChange={(event) => setDeletionConfirmation(event.target.value)}
                pattern="ELIMINAR"
                required
                value={deletionConfirmation}
              />
            </label>
            <button disabled={pending || deletionConfirmation !== "ELIMINAR"} type="submit">
              Eliminar mi cuenta
            </button>
          </form>
          <button disabled={pending} onClick={signOut} type="button">
            Cerrar sesión
          </button>
        </>
      ) : (
        <form className="account-form" onSubmit={(event) => submit(event, "sign-in")}>
          <label>
            Correo
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Contraseña
            <input
              autoComplete="current-password"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <div className="account-actions">
            <button disabled={pending} type="submit">
              Entrar
            </button>
            <button
              disabled={pending}
              onClick={(event) => void submit(event, "sign-up")}
              type="button"
            >
              Crear cuenta
            </button>
          </div>
        </form>
      )}
      {message ? <p aria-live="polite">{message}</p> : null}
    </aside>
  );
}
