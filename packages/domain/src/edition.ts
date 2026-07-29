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

export function getEditionWindow(localDate: string, timeZone = "Europe/Madrid"): EditionWindow {
  const date = Temporal.PlainDate.from(localDate);
  const opensAt = date.toZonedDateTime({ timeZone, plainTime: "00:00" }).toInstant();
  const closesAt = date
    .add({ days: 1 })
    .toZonedDateTime({ timeZone, plainTime: "00:00" })
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
