import { type Href, Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { getAuthClient } from "../src/player-auth";

export default function Layout() {
  const router = useRouter();

  useEffect(() => {
    const auth = getAuthClient();
    if (!auth) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") auth.auth.startAutoRefresh();
      else auth.auth.stopAutoRefresh();
    });
    auth.auth.startAutoRefresh();
    return () => {
      subscription.remove();
      auth.auth.stopAutoRefresh();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let active = true;
    let remove: (() => void) | undefined;
    void import("expo-notifications").then(async (Notifications) => {
      if (!active) return;
      const open = (value: unknown) => {
        if (typeof value !== "string" || !isSafeDeepLink(value)) return;
        router.push(value as Href);
      };
      const initial = await Notifications.getLastNotificationResponseAsync();
      if (active && initial) {
        open(initial.notification.request.content.data?.deepLink);
        await Notifications.clearLastNotificationResponseAsync();
      }
      const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
        open(response.notification.request.content.data?.deepLink),
      );
      remove = () => subscription.remove();
    });
    return () => {
      active = false;
      remove?.();
    };
  }, [router]);
  return <Stack screenOptions={{ headerShown: false }} />;
}

function isSafeDeepLink(value: string): boolean {
  return value === "/" || /^\/resultados\/[0-9a-f-]{36}$/i.test(value);
}
