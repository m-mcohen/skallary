// tests/domain/spending-curve.test.ts
//
// The Dashboard chart's three lines: this month, last
// month and the average month, each a running total by day. Each point is the
// same arithmetic as the figures already on the Dashboard, and the tests below
// hold the lines to those figures.
import { describe, expect, test } from "vitest";
import { spendingCurves } from "../../src/domain/spending-curve";
import { spentMonthToDate, sumForBaseline } from "../../src/domain/compare";
import { monthBounds, monthIndex, periodFromIndex } from "../../src/domain/period";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const accounts: Account[] = [
  { id: "card", name: "Card", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  { id: "off", name: "Not counted", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "me" },
];

let n = 0;
const t = (date: string, amountCents: number, over: Partial<NormalizedTxn> = {}): NormalizedTxn =>
  ({ sourceTransactionId: `t${n++}`, accountId: "card", date, amountCents, sourceCategory: "Groceries", merchant: null, isTransfer: false, sourceUpdatedAt: null, payee: "Store", ...over }) as NormalizedTxn;

/** Spending on the 3rd, 14th and 28th of every month from 2025-08 to 2026-10, plus noise that must not count. */
function history(): NormalizedTxn[] {
  const rows: NormalizedTxn[] = [];
  for (let idx = monthIndex("2025-08"); idx <= monthIndex("2026-10"); idx++) {
    const m = periodFromIndex(idx);
    const k = idx % 7;
    rows.push(t(`${m}-03`, -(10000 + k * 1111)), t(`${m}-14`, -(4000 + k * 333)), t(`${m}-28`, -(2500 + k * 77)));
    rows.push(t(`${m}-15`, 1200)); // a refund in a spending category reduces spending
    rows.push(t(`${m}-10`, -99999, { isTransfer: true })); // a transfer is not spending
    rows.push(t(`${m}-11`, -88888, { accountId: "off" })); // an account switched off for spending
    rows.push(t(`${m}-12`, 500000, { sourceCategory: "Paychecks" })); // income is not spending
  }
  return rows;
}

describe("spendingCurves: the three checks the numbers must pass", () => {
  const rows = history();
  const asOf = "2026-10-20";
  const curves = spendingCurves(rows, accounts, {}, asOf);
  const spent = spentMonthToDate(rows, accounts, {}, asOf);

  test("this month's line at today equals Spent this month", () => {
    expect(curves.today).toBe(20);
    expect(curves.thisMonth).toHaveLength(20);
    expect(curves.thisMonth[19]).toBe(spent.cents);
  });

  test("last month's line at today's day equals Last month, same days", () => {
    expect(curves.lastMonth![19]).toBe(spent.baseline!.cents);
  });

  test("the average month's line at Day 31 equals the 12 full months before this one, divided by 12", () => {
    const months = Array.from({ length: 12 }, (_, i) => monthBounds(periodFromIndex(monthIndex("2026-10") - 12 + i)));
    expect(curves.averageMonth![30]).toBe(sumForBaseline(rows, accounts, {}, { ranges: months, divideBy: 12 }).expenseCents);
  });

  test("the gray lines run to Day 31, and last month is named", () => {
    expect(curves.days).toBe(31);
    expect(curves.lastMonth).toHaveLength(31);
    expect(curves.averageMonth).toHaveLength(31);
    expect(curves.month).toBe("2026-10");
    expect(curves.lastMonthLabel).toBe("September");
  });
});

describe("spendingCurves: short months, short history, the 1st", () => {
  test("a day last month did not have carries last month's total", () => {
    const rows = [t("2026-08-31", -100), t("2026-09-30", -5000), t("2026-10-02", -700)];
    const c = spendingCurves(rows, accounts, {}, "2026-10-15");
    expect(c.lastMonth![29]).toBe(5000); // Day 30
    expect(c.lastMonth![30]).toBe(5000); // Day 31: September has none, so it holds
  });

  test("the average clamps a short month to its last day", () => {
    // One $120 charge on the last day of each of the 12 months before October 2026.
    const rows: NormalizedTxn[] = [t("2025-09-01", -1)];
    for (let idx = monthIndex("2025-10"); idx <= monthIndex("2026-09"); idx++) {
      rows.push(t(monthBounds(periodFromIndex(idx)).to, -12000));
    }
    const c = spendingCurves(rows, accounts, {}, "2026-10-15");
    expect(c.averageMonth![27]).toBe(1000); // Day 28: only February (28 days) has charged
    expect(c.averageMonth![29]).toBe(5 * 1000); // Day 30: Feb plus the four 30-day months
    expect(c.averageMonth![30]).toBe(12000); // Day 31: every month
  });

  test("with history back to July only, last month is drawn and the average is not", () => {
    const rows = [t("2026-07-01", -100), t("2026-09-10", -200), t("2026-10-02", -300)];
    const c = spendingCurves(rows, accounts, {}, "2026-10-15");
    expect(c.lastMonth).not.toBeNull();
    expect(c.averageMonth).toBeNull();
  });

  test("with no history before this month, neither gray line is drawn", () => {
    const c = spendingCurves([t("2026-10-02", -300)], accounts, {}, "2026-10-15");
    expect(c.lastMonth).toBeNull();
    expect(c.averageMonth).toBeNull();
  });

  test("on the 1st, this month's line is one point", () => {
    const c = spendingCurves([t("2026-08-01", -1), t("2026-10-01", -300)], accounts, {}, "2026-10-01");
    expect(c.today).toBe(1);
    expect(c.thisMonth).toEqual([300]);
  });
});

describe("spendingCurves: last year and the 3-month average", () => {
  const rows = history();
  const asOf = "2026-10-20";
  const curves = spendingCurves(rows, accounts, {}, asOf);

  test("last year's line at today's day equals the same days of the same month a year ago", () => {
    const sameDays = sumForBaseline(rows, accounts, {}, { ranges: [{ from: "2025-10-01", to: "2025-10-20" }], divideBy: 1 });
    expect(curves.lastYear![19]).toBe(sameDays.expenseCents);
    expect(curves.lastYearLabel).toBe("October 2025");
  });

  test("the 3-month average at Day 31 equals the 3 full months before this one, divided by 3", () => {
    const months = ["2026-07", "2026-08", "2026-09"].map(monthBounds);
    expect(curves.averageThree![30]).toBe(sumForBaseline(rows, accounts, {}, { ranges: months, divideBy: 3 }).expenseCents);
  });

  test("a partial January: the 3 months before cross the year, a late charge waits for its day, and an empty month still counts", () => {
    // Jan 10, 2027. The 3 months before: Oct, Nov (no spending at all) and Dec 2026.
    const rows = [t("2026-10-01", -3000), t("2026-12-05", -6000), t("2026-12-20", -90000)];
    const c = spendingCurves(rows, accounts, {}, "2027-01-10");
    expect(c.averageThree![9]).toBe(3000); // Day 10: (30.00 + 0 + 60.00) / 3; the Dec 20 charge is not yet counted
    expect(c.averageThree![30]).toBe(33000); // Day 31: (30.00 + 0 + 960.00) / 3
  });

  test("history back to June only: the 3-month average is drawn, last year and the 12-month average are not", () => {
    const short = [t("2026-06-01", -100), t("2026-09-10", -200), t("2026-10-02", -300)];
    const c = spendingCurves(short, accounts, {}, "2026-10-15");
    expect(c.averageThree).not.toBeNull();
    expect(c.lastYear).toBeNull();
    expect(c.averageMonth).toBeNull();
  });
});
