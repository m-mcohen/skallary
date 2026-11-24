// tests/domain/spending-range.test.ts
//
// The spending chart's longer ranges (chosen in the look round): 3 months,
// 6 months, year to date and 12 months, plotted by week, against the same length of
// time just before. Every point is the same arithmetic as the month's line
// (sumForBaseline), so the tests hold the points to it.
import { describe, expect, test } from "vitest";
import { spendingRange } from "../../src/domain/spending-range";
import { sumForBaseline } from "../../src/domain/compare";
import { monthIndex, periodFromIndex } from "../../src/domain/period";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const accounts: Account[] = [
  { id: "card", name: "Card", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
];

let n = 0;
const t = (date: string, amountCents: number, over: Partial<NormalizedTxn> = {}): NormalizedTxn =>
  ({ sourceTransactionId: `t${n++}`, accountId: "card", date, amountCents, sourceCategory: "Groceries", merchant: null, isTransfer: false, sourceUpdatedAt: null, payee: "Store", ...over }) as NormalizedTxn;

/** Spending on the 3rd, 14th and 28th of every month from 2024-08 to 2026-10, a refund, and a transfer that must not count. */
function history(firstMonth = "2024-08"): NormalizedTxn[] {
  const rows: NormalizedTxn[] = [];
  for (let idx = monthIndex(firstMonth); idx <= monthIndex("2026-10"); idx++) {
    const m = periodFromIndex(idx);
    const k = idx % 7;
    rows.push(t(`${m}-03`, -(10000 + k * 1111)), t(`${m}-14`, -(4000 + k * 333)), t(`${m}-28`, -(2500 + k * 77)));
    rows.push(t(`${m}-15`, 1200));
    rows.push(t(`${m}-10`, -99999, { isTransfer: true }));
  }
  return rows;
}

const spent = (rows: NormalizedTxn[], from: string, to: string) =>
  sumForBaseline(rows, accounts, {}, { ranges: [{ from, to }], divideBy: 1 }).expenseCents;

describe("spendingRange: the span and the one before it", () => {
  const rows = history();
  const asOf = "2026-10-20";

  test("3 months ends today and starts the day after the same date 3 months back", () => {
    const r = spendingRange(rows, accounts, {}, asOf, "3m")!;
    expect(r.from).toBe("2026-07-21");
    expect(r.to).toBe(asOf);
  });

  test("year to date starts on January 1st", () => {
    expect(spendingRange(rows, accounts, {}, asOf, "ytd")!.from).toBe("2026-01-01");
  });

  test("the span before has the same number of days and ends the day before", () => {
    for (const range of ["3m", "6m", "ytd", "12m"] as const) {
      const r = spendingRange(rows, accounts, {}, asOf, range)!;
      const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000 + 1;
      expect(days(r.priorFrom, r.priorTo)).toBe(days(r.from, r.to));
      expect(Date.parse(`${r.from}T00:00:00Z`) - Date.parse(`${r.priorTo}T00:00:00Z`)).toBe(86400000);
    }
  });
});

describe("spendingRange: the points are the Dashboard's own arithmetic", () => {
  const rows = history();
  const asOf = "2026-10-20";
  const r = spendingRange(rows, accounts, {}, asOf, "3m")!;

  test("one point a week, the last week ending today", () => {
    expect(r.weeks).toHaveLength(Math.ceil(92 / 7));
    expect(r.weeks[0].from).toBe(r.from);
    expect(r.weeks[r.weeks.length - 1].to).toBe(asOf);
  });

  test("each week's amount is what that week cost", () => {
    for (const w of r.weeks) expect(w.weekly).toBe(spent(rows, w.from, w.to));
  });

  test("the running total at the last week is the whole span", () => {
    expect(r.weeks[r.weeks.length - 1].cumulative).toBe(spent(rows, r.from, r.to));
  });

  test("the span before is read the same way, week for week", () => {
    expect(r.weeks[r.weeks.length - 1].priorCumulative).toBe(spent(rows, r.priorFrom, r.priorTo));
    expect(r.weeks[2].priorWeekly).toBe(spent(rows, r.weeks[2].priorFrom, r.weeks[2].priorTo));
  });

  test("a transfer is left out, as everywhere else", () => {
    const withTransfer = [...rows, t("2026-09-01", -777777, { isTransfer: true })];
    expect(spendingRange(withTransfer, accounts, {}, asOf, "3m")!.weeks.at(-1)!.cumulative).toBe(r.weeks.at(-1)!.cumulative);
  });
});

describe("spendingRange: history that does not reach back", () => {
  test("no comparison when the data starts after the span before begins", () => {
    const r = spendingRange(history("2026-06"), accounts, {}, "2026-10-20", "3m")!;
    expect(r.priorAvailable).toBe(false);
    expect(r.weeks.every((w) => w.priorWeekly === null && w.priorCumulative === null)).toBe(true);
  });

  test("names the two lines in words", () => {
    const r = spendingRange(history(), accounts, {}, "2026-10-20", "6m")!;
    expect(r.label).toBe("Last 6 months");
    expect(r.priorLabel).toBe("The 6 months before");
    expect(spendingRange(history(), accounts, {}, "2026-10-20", "ytd")!.priorLabel).toBe("The same length before");
  });
});
