"use client";

import type { AnalyticsEventName } from "@ludico/contracts";
import { useEffect } from "react";
import { trackAnalytics } from "./analytics";

export function AnalyticsEvent({
  name,
  properties,
}: Readonly<{
  name: AnalyticsEventName;
  properties: Readonly<Record<string, boolean | number | string>>;
}>) {
  useEffect(() => {
    void trackAnalytics(name, properties);
  }, [name, properties]);
  return null;
}
