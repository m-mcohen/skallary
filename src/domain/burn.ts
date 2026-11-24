// src/domain/burn.ts -- average monthly spending over recent complete months.
//
// Pure, so the snapshot a bank sync writes (server/services/snapshotService.ts)
// can be tested. The snapshot used to store the TOTAL over its 3 and
// 12 most recent months, current partial month included, in columns the Notes
// screen heads "Burn (3mo)" and "Burn (12mo)" beside hand-entered MONTHLY
// figures. This is the monthly figure: the N calendar months before the
// current one, a month with no spending counted as zero, divided by N -- the
// same basis as the Dashboard's Trailing 12mo.
import { addMonths } from "./scenario";

// Money put away is NOT burn. The parameter takes the full rollup, saving and
// investment income included, and counts only `expense` -- treating a brokerage
// contribution as burn would shorten the runway for the act of saving, which is
// backwards.
export function trailingMonthlyBurnCents(
  rollups: { period: string; kind: string; amountCents: number }[],
  months: number,
  currentPeriod: string
): number {
  if (months <= 0) return 0;
  const window = new Set(Array.from({ length: months }, (_, i) => addMonths(currentPeriod, -(i + 1))));
  let total = 0;
  for (const r of rollups) {
    if (r.kind === "expense" && window.has(r.period)) total += r.amountCents;
  }
  return Math.round(total / months);
}
