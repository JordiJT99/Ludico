"use client";

import { useEffect, useState } from "react";

export function GuestSessionBootstrap() {
  const [status, setStatus] = useState<"pending" | "ready" | "local-only">("pending");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/guest-session", { method: "POST", signal: controller.signal })
      .then((response) => setStatus(response.ok ? "ready" : "local-only"))
      .catch(() => {
        if (!controller.signal.aborted) setStatus("local-only");
      });
    return () => controller.abort();
  }, []);

  return (
    <p aria-live="polite" className="session-status">
      {status === "pending"
        ? "Preparando el guardado…"
        : status === "ready"
          ? "Tu progreso se guardará como invitado."
          : "Sin conexión: el progreso se guardará en este dispositivo."}
    </p>
  );
}
