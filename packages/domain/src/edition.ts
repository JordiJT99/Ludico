import { Temporal } from "@js-temporal/polyfill";

export const editionStatuses = [
  "draft",
  "validating",
  "approved",
  "scheduled",
  "published",
  "closed",
  "archived",
  "rejected",
  "cancelled",
] as const;

export type EditionStatus = (typeof editionStatuses)[number];

const transitions: Readonly<Record<EditionStatus, readonly EditionStatus[]>> = {
  draft: ["validating", "cancelled"],
  validating: ["approved", "rejected"],
  approved: ["scheduled", "cancelled"],
  scheduled: ["published", "cancelled"],
  published: ["closed"],
  closed: ["archived"],
  archived: [],
  rejected: [],
  cancelled: [],
};

export interface EditionWindow {
  readonly opensAt: Date;
  readonly closesAt: Date;
}

export interface EditionSchedule {
  readonly closesAtLocalTime?: string;
  readonly opensAtLocalTime?: string;
}

export function getEditionWindow(
  localDate: string,
  timeZone = "Europe/Madrid",
  schedule: EditionSchedule = {},
): EditionWindow {
  const date = Temporal.PlainDate.from(localDate);
  const opensAtLocalTime = Temporal.PlainTime.from(schedule.opensAtLocalTime ?? "00:00");
  const closesAtLocalTime = Temporal.PlainTime.from(schedule.closesAtLocalTime ?? "00:00");
  const closesOnNextDate = Temporal.PlainTime.compare(closesAtLocalTime, opensAtLocalTime) <= 0;
  const opensAt = date.toZonedDateTime({ timeZone, plainTime: opensAtLocalTime }).toInstant();
  const closesAt = (closesOnNextDate ? date.add({ days: 1 }) : date)
    .toZonedDateTime({ timeZone, plainTime: closesAtLocalTime })
    .toInstant();

  return {
    opensAt: new Date(opensAt.epochMilliseconds),
    closesAt: new Date(closesAt.epochMilliseconds),
  };
}

export function assertEditionTransition(from: EditionStatus, to: EditionStatus): void {
  if (from === to) return;
  if (!transitions[from].includes(to)) throw new InvalidEditionTransitionError(from, to);
}

export class InvalidEditionTransitionError extends Error {
  constructor(
    readonly from: EditionStatus,
    readonly to: EditionStatus,
  ) {
    super(`No se puede cambiar una edición de ${from} a ${to}`);
    this.name = "InvalidEditionTransitionError";
  }
}
