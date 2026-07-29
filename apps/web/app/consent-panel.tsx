"use client";

import { currentConsentPolicyVersion, isConsentState, type ConsentState } from "@ludico/contracts";
import { useEffect, useState } from "react";
import { setAnalyticsEnabled, trackAnalytics } from "./analytics";
import { ensurePlayerSession } from "./player-session";

type Choice = Pick<ConsentState, "ads" | "analytics">;

export function ConsentPanel({ adsMode }: Readonly<{ adsMode: "disabled" | "test" }>) {
  const [consent, setConsent] = useState<ConsentState>();
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<Choice>({ ads: false, analytics: false });
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void loadConsent(controller.signal).then((current) => {
      if (!current) return;
      setConsent(current);
      setChoice({ ads: current.ads, analytics: current.analytics });
      setAnalyticsEnabled(current.analytics);
      if (current.recordedAt === null || current.policyVersion !== currentConsentPolicyVersion) {
        setEditing(true);
      } else if (current.analytics) {
        void sendAppOpened();
      }
    });
    return () => controller.abort();
  }, []);

  async function save(next: Choice) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/player/consents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...next, policyVersion: currentConsentPolicyVersion }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isConsentState(body)) throw new Error("consent");
      setConsent(body);
      setChoice({ ads: body.ads, analytics: body.analytics });
      setAnalyticsEnabled(body.analytics);
      setEditing(false);
      setMessage("Preferencias de privacidad guardadas.");
      if (body.analytics) await sendAppOpened();
    } catch {
      setMessage("No se pudieron guardar. Inténtalo de nuevo cuando tengas conexión.");
    }
    setPending(false);
  }

  const showTestAd = consent?.ads === true && adsMode === "test";
  return (
    <>
      <div aria-label="Espacio publicitario" className="ad-reservation">
        {showTestAd ? <span>Anuncio de prueba</span> : null}
      </div>
      <aside aria-labelledby="privacy-heading" className="privacy-panel">
        {editing ? (
          <div aria-modal="false" className="privacy-dialog" role="dialog">
            <h2 id="privacy-heading">Tu privacidad</h2>
            <p>
              Las funciones necesarias guardan tu partida. Puedes decidir por separado si permites
              medición anónima y anuncios de prueba.
            </p>
            <label className="checkbox-label">
              <input checked disabled type="checkbox" />
              Funciones necesarias
            </label>
            <label className="checkbox-label">
              <input
                checked={choice.analytics}
                onChange={(event) => setChoice({ ...choice, analytics: event.target.checked })}
                type="checkbox"
              />
              Analítica de uso sin respuestas ni texto libre
            </label>
            <label className="checkbox-label">
              <input
                checked={choice.ads}
                onChange={(event) => setChoice({ ...choice, ads: event.target.checked })}
                type="checkbox"
              />
              Anuncios (solo modo de prueba en este entorno)
            </label>
            <div className="privacy-actions">
              <button
                disabled={pending}
                onClick={() => void save({ ads: false, analytics: false })}
              >
                Solo necesarias
              </button>
              <button disabled={pending} onClick={() => void save(choice)}>
                Guardar selección
              </button>
              <button disabled={pending} onClick={() => void save({ ads: true, analytics: true })}>
                Aceptar opcionales
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} type="button">
            Privacidad
          </button>
        )}
        {message ? <p aria-live="polite">{message}</p> : null}
      </aside>
    </>
  );
}

async function loadConsent(signal: AbortSignal): Promise<ConsentState | null> {
  try {
    if (!(await ensurePlayerSession(signal))) return null;
    const response = await fetch("/api/player/consents/current", { cache: "no-store", signal });
    const body: unknown = await response.json();
    return response.ok && isConsentState(body) ? body : null;
  } catch {
    return null;
  }
}

async function sendAppOpened(): Promise<void> {
  const key = "ludico.analytics.app-opened.v1";
  if (sessionStorage.getItem(key)) return;
  await trackAnalytics("AppOpened", {
    connectivity: navigator.onLine ? "online" : "offline",
    platform: "web",
    source: "navigation",
  });
  sessionStorage.setItem(key, "1");
}
