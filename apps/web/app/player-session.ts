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
