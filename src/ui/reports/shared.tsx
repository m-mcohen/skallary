// src/ui/reports/shared.tsx
//
// Pieces every Reports tab uses: the figure that opens its ledger, the change
// cells of a comparison, the partial-month note, and the cell styles. Moved out of
// ReportsSection.tsx so the Spending and Income panel can
// live in its own file.
import { formatCents } from "../../domain/money";
import { partialMonthNote } from "../../domain/period";
import type { Baseline, BaselineSegment, BaselineSums, Comparison } from "../../domain/compare";
import { ledgerHref, type LedgerSpec } from "../lib/ledger-link";

export const MONEY = "font-mono tabular-nums";
// Every figure cell: right-aligned, never wrapped, and spaced from its neighbor
// so two amounts cannot read as one. They are click targets, so a figure has to
// be unmistakably its own.
export const FIGURE_CELL = "py-1.5 pl-4 text-right whitespace-nowrap";
export const FIGURE_HEAD = "pb-2 pl-4 text-right whitespace-nowrap";
// The row label stays put while the months scroll sideways, so a figure far to
// the right can still be read against its category.
export const ROW_LABEL = "sticky left-0 z-10 bg-card pr-2";
export const CLICK_HINT = "Click any figure to see the transactions behind it.";

/** A baseline that can be compared against: its ranges, its figures, and its month-by-month segments. */
export interface ActiveComparison {
  label: string;
  baseline: Baseline;
  sums: BaselineSums;
  /** The baseline behind each month of the period, for the marker on a chart by month. Null when the months do not line up. */
  segments: BaselineSegment[] | null;
}

/** "+$100.00", "-$50.00", "$0.00": the sign is the direction, in text, not only in color. */
export const signedCents = (cents: number) => (cents > 0 ? `+${formatCents(cents)}` : formatCents(cents));
export const signedPct = (pct: number | null) => (pct == null ? "n/a" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`);

/** Color marks favorable or not; the title says it in words, so color is never the only signal. */
function favorableProps(c: Comparison) {
  const word = c.direction === "up" ? "Up" : c.direction === "down" ? "Down" : "No change";
  return {
    "data-favorable": c.favorable == null ? "none" : String(c.favorable),
    title: c.favorable == null ? word : `${word}, ${c.favorable ? "favorable" : "unfavorable"}`,
    className: `${FIGURE_CELL} ${MONEY} ${c.favorable == null ? "text-muted-foreground" : c.favorable ? "text-positive" : "text-destructive"}`,
  };
}

/** A change is a difference between two sums, not a sum, so it never opens a ledger. */
export function ChangeCells({ c, idPrefix, idSuffix }: { c: Comparison; idPrefix?: string; idSuffix: string }) {
  const id = (name: string) => `${idPrefix ?? ""}${name}-${idSuffix}`;
  return (
    <>
      <td data-testid={id("change")} {...favorableProps(c)}>
        {signedCents(c.changeCents)}
      </td>
      <td data-testid={id("changepct")} {...favorableProps(c)}>
        {signedPct(c.changePct)}
      </td>
    </>
  );
}

/** Under a chart whose last month is not over: which day it runs through. */
export function PartialMonthNote({ periods, rangeTo }: { periods: string[]; rangeTo: string | null }) {
  const note = partialMonthNote(periods, rangeTo);
  return note ? <p className="pt-2 text-xs text-muted-foreground">{note}</p> : null;
}

/**
 * A summed figure that opens the ledger behind it. A zero has nothing behind
 * it, so it stays plain text rather than a link to an empty list.
 */
export function Figure({ cents, spec }: { cents: number; spec: LedgerSpec }) {
  const shown = formatCents(cents);
  if (cents === 0) return <>{shown}</>;
  return (
    <a data-ledger="1" href={ledgerHref(spec)} className="underline-offset-4 hover:underline">
      {shown}
    </a>
  );
}
