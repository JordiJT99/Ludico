"use client";

export async function ensurePlayerSession(signal: AbortSignal): Promise<boolean> {
  try {
    const session = await fetch("/api/auth/session", { cache: "no-store", signal });
    if (session.ok && ((await session.json()) as { email?: string | null }).email) return true;
    return (await fetch("/api/guest-session", { method: "POST", signal })).ok;
  } catch {
    return false;
  }
}

export async function renewGuestSession(signal: AbortSignal): Promise<boolean> {
  try {
    const cleared = await fetch("/api/guest-session", { method: "DELETE", signal });
    return cleared.ok && (await ensurePlayerSession(signal));
  } catch {
    return false;
  }
}
