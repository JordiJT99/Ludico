import { generatedContentTypes, type GeneratedContentType } from "@ludico/domain";

export function lowReserveAlert(reserve: Readonly<Record<GeneratedContentType, number>>) {
  if (generatedContentTypes.every((type) => reserve[type] >= 10)) return null;
  return { code: "CONTENT_RESERVE_LOW", reserve, thresholdDays: 10 } as const;
}
