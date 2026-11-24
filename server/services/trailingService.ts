// server/services/trailingService.ts
//
// Average monthly EXPENSE over the trailing N complete months -- the
// "trailing" readout in the masthead. Reads actuals through the seed's own
// preparation (seedBudgetService.preparedRollups) so this number and a seed
// run on the same day agree about what counts as spend: effective account
// include, rules, transfer pairing, adjustments, category mapping, income
// kept out, transfers kept out.
//
// Unlike the seed, the window always ends with the month BEFORE the current
// one, whether or not that month has data yet: this is a readout of the
// calendar, not of coverage. The seed instead ends after the latest actual.
import { preparedRollups } from "./seedBudgetService.js";
import { localDateIso } from "../../src/domain/period.js";
import { priorMonths } from "../../src/domain/seed.js";

export interface TrailingSpend {
  months: number;
  /** The N months summed, oldest first, YYYY-MM. */
  window: string[];
  /** Money out, positive cents. */
  totalCents: number;
  /** totalCents / months, rounded -- months with no data still count. */
  monthlyAverageCents: number;
}

/** Not plan-scoped: actuals are shared across plans, so there is nothing to key on. */
export function trailingSpend(months: number = 12, now: () => Date = () => new Date()): TrailingSpend {
  if (!Number.isInteger(months) || months < 1) {
    throw new Error(`months must be a positive whole number, got ${JSON.stringify(months)}.`);
  }
  // The LOCAL calendar month, as every other Dashboard figure reads it: the
  // UTC month turned on the last evening of a month, counting a month not yet over as complete.
  const window = priorMonths(localDateIso(now()).slice(0, 7), months);
  const inWindow = new Set(window);

  // rollupMonthly already reports expense as a positive magnitude, drops
  // transfers, and tags income by kind -- so this is a filter and a sum.
  let totalCents = 0;
  for (const r of preparedRollups()) {
    if (r.kind !== "expense" || !inWindow.has(r.period)) continue;
    totalCents += r.amountCents;
  }

  return { months, window, totalCents, monthlyAverageCents: Math.round(totalCents / months) };
}
