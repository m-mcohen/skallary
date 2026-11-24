// src/domain/maaser-marks.ts -- the two per-row maaser marks.
//
// "not_maaser" sits on a gift row: the row stays in Charity for spending and taxes but is left out of
// the maaser ledger. "income" sits on an income row: it counts none of the amount (countedCents null)
// or only the part named. Pure; shared by the server and the screens.

export type MaaserMarkKind = "not_maaser" | "income";

export interface MaaserMark {
  sourceTransactionId: string;
  kind: MaaserMarkKind;
  /** Income marks only: the part of the row that counts; null = none of it. */
  countedCents: number | null;
  updatedAt: string;
}

export type MaaserMarkInput = Omit<MaaserMark, "updatedAt">;

/** A mark as sent, or the plain-words reason it is refused. */
export function cleanMaaserMark(id: unknown, raw: unknown): MaaserMarkInput | string {
  if (typeof id !== "string" || !id.trim()) return "Unknown transaction.";
  if (raw === null || typeof raw !== "object") return "Unknown mark.";
  const { kind, countedCents } = raw as { kind?: unknown; countedCents?: unknown };
  if (kind !== "not_maaser" && kind !== "income") return "A mark is either not maaser or income for maaser.";
  const given = countedCents !== undefined && countedCents !== null;
  if (kind === "not_maaser") {
    if (given) return "Only an income mark can count part of the amount.";
    return { sourceTransactionId: id.trim(), kind, countedCents: null };
  }
  if (given && !(typeof countedCents === "number" && Number.isInteger(countedCents) && countedCents > 0)) {
    return "The part that counts is whole dollars and cents, above zero.";
  }
  return { sourceTransactionId: id.trim(), kind, countedCents: given ? (countedCents as number) : null };
}

export function marksById(marks: MaaserMark[]): Map<string, MaaserMark> {
  return new Map(marks.map((m) => [m.sourceTransactionId, m]));
}

/** What an income row counts as: its amount, zero under an income mark with no amount, else the amount the mark names. A mark of another kind leaves it alone. */
export function countedIncomeCents(amountCents: number, mark: MaaserMark | undefined): number {
  if (!mark || mark.kind !== "income") return amountCents;
  // The part is typed as a positive amount; a negative row (a correction) keeps its sign.
  const part = mark.countedCents ?? 0;
  return amountCents < 0 && part !== 0 ? -part : part;
}
