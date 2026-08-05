import { generatedContentTypes, type GeneratedContentType } from "@ludico/domain";

export function lowReserveAlert(reserve: Readonly<Record<GeneratedContentType, number>>) {
  const days = Math.min(...generatedContentTypes.map((type) => reserve[type]));
  if (days >= 10) return null;
  const severity = days < 2 ? "emergency" : days < 5 ? "critical" : "warning";
  return {
    code: "CONTENT_RESERVE_LOW",
    reserve,
    severity,
    thresholdDays: severity === "warning" ? 10 : severity === "critical" ? 5 : 2,
  } as const;
}
