"use client";

import { isShareResult } from "@ludico/contracts";
import { useState } from "react";
import { trackAnalytics } from "./analytics";

export function ShareButton({ attemptId }: Readonly<{ attemptId: string }>) {
  const [status, setStatus] = useState<string>();

  async function share() {
    try {
      const response = await fetch("/api/player/share-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId }),
      });
      const result: unknown = await response.json();
      if (!response.ok || !isShareResult(result)) throw new Error("share");
      if (navigator.share) {
        await navigator.share({
          text: result.text,
          title: "Mi resultado en Lúdico",
          url: result.url,
        });
        setStatus("Resultado compartido.");
        void trackAnalytics("ShareCompleted", {
          attemptId,
          channelCategory: "native",
          platform: "web",
          result: "success",
        });
      } else {
        await navigator.clipboard.writeText(`${result.text}\n${result.url}`);
        setStatus("Resultado copiado.");
        void trackAnalytics("ShareCompleted", {
          attemptId,
          channelCategory: "clipboard",
          platform: "web",
          result: "success",
        });
      }
    } catch {
      setStatus("No se pudo compartir el resultado.");
    }
  }

  return (
    <>
      <button onClick={() => void share()} type="button">
        Compartir resultado
      </button>
      {status ? <p aria-live="polite">{status}</p> : null}
    </>
  );
}
