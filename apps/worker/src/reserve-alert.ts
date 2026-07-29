export function lowReserveAlert(reserve: Readonly<{ crossword: number; quiz: number }>) {
  if (reserve.crossword >= 10 && reserve.quiz >= 10) return null;
  return { code: "CONTENT_RESERVE_LOW", reserve, thresholdDays: 10 } as const;
}
