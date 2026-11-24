// tests/domain/same-days-categories.test.ts
//
// This time in this month against this time last month: each of the Dashboard card's top 5
// categories also carries its spending by the same day last month. It is the
// baseline the card already compares with (spentMonthToDate's same days, clamped
// to a short month; a whole month against the whole month before on a past month),
// split by category through the same rollup, so a category's figure equals the
// ledger of that category on those days.
import { describe, expect, test } from "vitest";
import { spentMonthToDate } from "../../src/domain/compare";
import { monthEnded, type MonthSource } from "../../src/domain/dashboard-month";
import { EMPTY_FILTER, filterRows, ledgerTotal, toRows } from "../../src/domain/transactions-view";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const accounts = [
  { id: "a", name: "A", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  { id: "x", name: "X", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "me" },
] as Account[];
const t = (id: string, date: string, amountCents: number, sourceCategory: string, over: Partial<NormalizedTxn> = {}) =>
  ({ sourceTransactionId: id, accountId: "a", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over }) as NormalizedTxn;

// By hand. Today is Sep 20, 2026.
//   This month, Sep 1 to 20: Rent $2,000.00; Groceries $300.00 + $100.00 = $400.00;
//     Dining $50.00; Gifts $20.00. (Groceries $999.00 on the 21st is not yet.)
//   Last month, same days, Aug 1 to 20:
//     Rent $1,800.00
//     Groceries $250.00 + $10.00 (the 20th counts) - $30.00 refund = $230.00 ($888.00 on the 21st does not count)
//     Dining $40.00 (the $70.00 on an account not counted is left out)
//     Gifts nothing: $0.00
//     Coffee $15.00: not a top category this month, so not listed, but in the total
//   Same-days total: $1,800.00 + $230.00 + $40.00 + $15.00 = $2,085.00
const txns = [
  t("s1", "2026-09-01", -200000, "Rent"),
  t("s2", "2026-09-03", -30000, "Groceries"),
  t("s3", "2026-09-20", -10000, "Groceries"),
  t("s4", "2026-09-10", -5000, "Dining"),
  t("s5", "2026-09-05", -2000, "Gifts"),
  t("s6", "2026-09-21", -99900, "Groceries"),
  t("b1", "2026-08-01", -180000, "Rent"),
  t("b2", "2026-08-05", -25000, "Groceries"),
  t("b3", "2026-08-20", -1000, "Groceries"),
  t("b4", "2026-08-21", -88800, "Groceries"),
  t("b5", "2026-08-10", 3000, "Groceries"),
  t("b6", "2026-08-15", -4000, "Dining"),
  t("b7", "2026-08-20", -7000, "Dining", { accountId: "x" }),
  t("b8", "2026-08-04", -1500, "Coffee"),
  // July, so the history reaches back past August (and a whole July for the past-month case).
  t("j1", "2026-07-01", -170000, "Rent"),
  t("j2", "2026-07-31", -6000, "Groceries"),
];

/** The ledger a category's figure opens: that category, spending, counted accounts, those days. */
function ledgerCents(category: string, range: { from: string; to: string }): number {
  const rows = filterRows(toRows(txns, accounts, {}), {
    ...EMPTY_FILTER,
    categories: [category],
    kind: "expense",
    countedAccountsOnly: true,
    ...range,
  });
  return ledgerTotal(rows).expenseCents;
}

describe("each top category, by the same day last month", () => {
  test("is the category's spending on last month's same days", () => {
    const m = spentMonthToDate(txns, accounts, {}, "2026-09-20");
    expect(m.topCategories.map((c) => c.category)).toEqual(["Rent", "Groceries", "Dining", "Gifts"]);
    expect(m.baseline!.range).toEqual({ from: "2026-08-01", to: "2026-08-20" });
    expect(m.baseline!.cents).toBe(208500);
    expect(m.baseline!.byCategory).toEqual({ Rent: 180000, Groceries: 23000, Dining: 4000, Gifts: 0 });
  });

  test("lists exactly the top categories, so a category not on the card is not carried", () => {
    const m = spentMonthToDate(txns, accounts, {}, "2026-09-20");
    expect(Object.keys(m.baseline!.byCategory).sort()).toEqual(m.topCategories.map((c) => c.category).sort());
  });

  test("each equals the sum of its ledger's rows", () => {
    const m = spentMonthToDate(txns, accounts, {}, "2026-09-20");
    for (const c of m.topCategories) {
      expect(m.baseline!.byCategory[c.category], c.category).toBe(ledgerCents(c.category, m.baseline!.range));
    }
  });

  test("a day last month did not have is clamped to its last day (Mar 30 against Feb 1 to Feb 28)", () => {
    // By hand: Feb 28 $12.00 counts, Mar 1 to 30 $40.00. Feb has no 29th or 30th in 2026.
    const short = [t("f0", "2026-01-15", -1, "Other"), t("f1", "2026-02-28", -1200, "Groceries"), t("m1", "2026-03-30", -4000, "Groceries")];
    const m = spentMonthToDate(short, accounts, {}, "2026-03-30");
    expect(m.baseline!.range).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(m.baseline!.byCategory).toEqual({ Groceries: 1200 });
  });

  test("with no history reaching back to last month there is no baseline at all, so no category figure", () => {
    const m = spentMonthToDate(txns.filter((x) => x.date >= "2026-09-01"), accounts, {}, "2026-09-20");
    expect(m.baseline).toBeNull();
  });
});

describe("on a past month, the month before in full", () => {
  test("August's top categories carry all of July, the 31st included", () => {
    const source: MonthSource = { prepared: txns, accounts, mapping: {}, budgetLines: [], today: "2026-09-20", firstMonth: "2026-07" };
    const aug = monthEnded(source, "2026-08");
    // By hand, August whole: Rent $1,800.00; Groceries $250.00 + $10.00 + $888.00 - $30.00 = $1,118.00;
    //   Dining $40.00; Coffee $15.00. July whole: Rent $1,700.00; Groceries $60.00 (the 31st); Dining and Coffee $0.00.
    expect(aug.spent.topCategories).toEqual([
      { category: "Rent", cents: 180000 },
      { category: "Groceries", cents: 111800 },
      { category: "Dining", cents: 4000 },
      { category: "Coffee", cents: 1500 },
    ]);
    expect(aug.spent.baseline!.range).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(aug.spent.baseline!.byCategory).toEqual({ Rent: 170000, Groceries: 6000, Dining: 0, Coffee: 0 });
    for (const c of aug.spent.topCategories) {
      expect(aug.spent.baseline!.byCategory[c.category], c.category).toBe(ledgerCents(c.category, aug.spent.baseline!.range));
    }
  });
});
