"use client";

import { useEffect, useRef, useState } from "react";

export function ServiceWorkerRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker>();
  const refreshRequested = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let refreshing = false;
    const onControllerChange = () => {
      if (!refreshRequested.current || refreshing) return;
      refreshing = true;
      location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(async (registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaiting(registration.waiting);
        }
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setWaiting(installing);
            }
          });
        });
        await navigator.serviceWorker.ready;
        try {
          const assets = performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((url) => new URL(url).pathname.startsWith("/_next/static/"));
          if (assets.length) {
            const cache = await caches.open("ludico-shell-v1");
            await Promise.allSettled(assets.map((asset) => cache.add(asset)));
          }
        } catch {
          // The shell remains usable even when opportunistic asset caching fails.
        }
      })
      .catch(() => undefined);
    return () =>
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!waiting) return null;
  return (
    <aside aria-live="polite" className="update-banner">
      <span>Hay una actualización disponible.</span>
      <button
        onClick={() => {
          refreshRequested.current = true;
          waiting.postMessage({ type: "SKIP_WAITING" });
        }}
        type="button"
      >
        Actualizar ahora
      </button>
    </aside>
  );
}
