// tests/domain/dashboard-month.test.ts
//
// Switch months on the Dashboard. Previous and
// next arrows beside the month name; next stops at this month, previous at the
// first month with transactions; a past month shows how it ended, in full.
// "Today" is pinned to 2026-10-02 so nothing here depends on the clock.
import { describe, expect, test } from "vitest";

import {
  firstMonthOf,
  monthBudgetCents,
  monthEnded,
  monthFromLink,
  monthNav,
  type MonthSource,
} from "../../src/domain/dashboard-month";
import type { BudgetLine } from "../../src/domain/plan-types";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const TODAY = "2026-10-02";

const accounts: Account[] = [
  { id: "card", name: "Card", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
];

let n = 0;
const t = (date: string, amountCents: number, sourceCategory = "Groceries", over: Partial<NormalizedTxn> = {}): NormalizedTxn =>
  ({ sourceTransactionId: `t${n++}`, accountId: "card", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, payee: "Store", ...over }) as NormalizedTxn;

// By hand:
//   July:   $25.00 (1st) + $100.00 (5th) + $50.00 (31st)                 = $175.00 spent
//   August: Rent $200.00 (1st); Groceries $30.00 (2nd), $70.00 (25th), $15.00 (31st)
//           = $315.00 spent; through the 2nd only it would be $230.00
//           income $5,000.00 (15th) + $1,000.00 (30th)                   = $6,000.00
//           left over $6,000.00 - $315.00                                 = $5,685.00
//   October: $40.00 on the 1st (this month so far)
const txns: NormalizedTxn[] = [
  t("2026-07-01", -2500),
  t("2026-07-05", -10000),
  t("2026-07-31", -5000),
  t("2026-08-01", -20000, "Rent"),
  t("2026-08-02", -3000),
  t("2026-08-25", -7000),
  t("2026-08-31", -1500),
  t("2026-08-15", 500000, "Paychecks", { payee: "Employer" }),
  t("2026-08-30", 100000, "Paychecks", { payee: "Employer" }),
  t("2026-10-01", -4000),
];

const line = (planningCategory: string, amountCents: number, period: string | null = null): BudgetLine => ({ planId: "p", planningCategory, period, amountCents });

// Budget by hand: Rent $200.00 every month; Groceries $100.00 usually, $150.00 in August
// (a one-month amount replaces the usual one); Paychecks is income, never budget.
//   August:    $200.00 + $150.00 = $350.00
//   September: $200.00 + $100.00 = $300.00
const budgetLines: BudgetLine[] = [line("Rent", 20000), line("Groceries", 10000), line("Groceries", 15000, "2026-08"), line("Paychecks", 500000)];

const source: MonthSource = { prepared: txns, accounts, mapping: {}, budgetLines, today: TODAY, firstMonth: "2026-07" };

describe("the month bar's limits", () => {
  test("the first month is the first month with transactions", () => {
    expect(firstMonthOf(txns)).toBe("2026-07");
    expect(firstMonthOf([])).toBeNull();
  });

  test("on this month, next is off (no future months) and previous is last month", () => {
    const nav = monthNav("2026-10", TODAY, "2026-07");
    expect(nav).toEqual({ month: "2026-10", thisMonth: "2026-10", current: true, previous: "2026-09", next: null });
  });

  test("at the first month, previous is off", () => {
    const nav = monthNav("2026-07", TODAY, "2026-07");
    expect(nav.previous).toBeNull();
    expect(nav.next).toBe("2026-08");
    expect(nav.current).toBe(false);
  });

  test("next from last month is this month, and never past it", () => {
    expect(monthNav("2026-09", TODAY, "2026-07").next).toBe("2026-10");
    expect(monthNav("2026-10", TODAY, "2026-07").next).toBeNull();
  });

  test("with no transactions at all there is nowhere to go", () => {
    expect(monthNav("2026-10", TODAY, null)).toMatchObject({ previous: null, next: null, current: true });
  });

  test("across a year end", () => {
    expect(monthNav("2026-01", TODAY, "2023-08")).toMatchObject({ previous: "2025-12", next: "2026-02" });
  });
});

describe("the month the link names", () => {
  test("a past month in range is that month", () => {
    expect(monthFromLink("2026-08", TODAY, "2026-07")).toBe("2026-08");
    expect(monthFromLink("2026-07", TODAY, "2026-07")).toBe("2026-07");
  });

  test("no month, a malformed one, or a future one is this month", () => {
    expect(monthFromLink(null, TODAY, "2026-07")).toBe("2026-10");
    expect(monthFromLink("", TODAY, "2026-07")).toBe("2026-10");
    expect(monthFromLink("2026-13", TODAY, "2026-07")).toBe("2026-10");
    expect(monthFromLink("August", TODAY, "2026-07")).toBe("2026-10");
    expect(monthFromLink("2026-11", TODAY, "2026-07")).toBe("2026-10");
    expect(monthFromLink("2031-01", TODAY, "2026-07")).toBe("2026-10");
  });

  test("a month before the first month is the first month", () => {
    expect(monthFromLink("2026-03", TODAY, "2026-07")).toBe("2026-07");
  });

  test("with no transactions, only this month exists", () => {
    expect(monthFromLink("2026-08", TODAY, null)).toBe("2026-10");
  });
});

describe("a past month shows how it ended", () => {
  const aug = monthEnded(source, "2026-08");

  test("spending is the whole month, not the 1st through today's day of the month", () => {
    expect(aug.spent.period).toEqual({ preset: "this-month", from: "2026-08-01", to: "2026-08-31" });
    expect(aug.spent.cents).toBe(31500); // $315.00, not $230.00 (Aug 1 to 2)
    expect(aug.spent.leftOverCents).toBe(568500); // $6,000.00 - $315.00
    expect(aug.spent.topCategories).toEqual([
      { category: "Rent", cents: 20000 },
      { category: "Groceries", cents: 11500 },
    ]);
  });

  test("it compares with the whole month before it", () => {
    // Each top category in all of July. Rent $0.00; Groceries $25.00 + $100.00 + $50.00 = $175.00.
    expect(aug.spent.baseline).toEqual({ range: { from: "2026-07-01", to: "2026-07-31" }, cents: 17500, byCategory: { Rent: 0, Groceries: 17500 } });
  });

  test("income is the whole month", () => {
    expect(aug.income.period).toEqual({ preset: "this-month", from: "2026-08-01", to: "2026-08-31" });
    expect(aug.income.cents).toBe(600000);
    expect(aug.income.baseline).toEqual({ range: { from: "2026-07-01", to: "2026-07-31" }, cents: 0 });
  });

  test("the day-by-day line runs the whole month and ends on the month's total", () => {
    expect(aug.curves.month).toBe("2026-08");
    expect(aug.curves.today).toBe(31);
    expect(aug.curves.thisMonth).toHaveLength(31);
    expect(aug.curves.thisMonth[1]).toBe(23000); // through Aug 2: $200.00 + $30.00
    expect(aug.curves.thisMonth[30]).toBe(31500);
    expect(aug.curves.lastMonth?.[30]).toBe(17500); // all of July
    expect(aug.curves.lastMonthLabel).toBe("July");
  });

  test("a 30-day month runs 30 days", () => {
    const sep = monthEnded(source, "2026-09");
    expect(sep.curves.today).toBe(30);
    expect(sep.curves.thisMonth).toHaveLength(30);
    expect(sep.spent.cents).toBe(0);
    expect(sep.spent.period.to).toBe("2026-09-30");
  });

  test("budget against actual: August's budget, what was spent, and the difference", () => {
    // $350.00 budget - $315.00 spent = $35.00 under.
    expect(aug.budget).toEqual({ budgetCents: 35000, spentCents: 31500, differenceCents: 3500 });
  });

  test("over budget is a negative difference", () => {
    const tight = monthEnded({ ...source, budgetLines: [line("Rent", 20000), line("Groceries", 5000)] }, "2026-08");
    // $250.00 budget - $315.00 spent = $65.00 over.
    expect(tight.budget).toEqual({ budgetCents: 25000, spentCents: 31500, differenceCents: -6500 });
  });
});

describe("a month's budget", () => {
  test("the usual amounts, a one-month amount in place of its usual one, income left out", () => {
    expect(monthBudgetCents(budgetLines, "2026-08")).toBe(35000);
    expect(monthBudgetCents(budgetLines, "2026-09")).toBe(30000);
  });

  test("with no lines it is zero", () => {
    expect(monthBudgetCents([], "2026-08")).toBe(0);
  });
});

test("a past month's budget counts that month's big months", () => {
  const lines = [{ planId: "p", planningCategory: "Gifts", period: null, amountCents: 10000 }];
  const big = [{ id: 1, planId: "p", planningCategory: "Gifts", month: "2026-12", label: "Holiday party", amountCents: 80000, createdAt: "" }];
  expect(monthBudgetCents(lines, "2026-12", big)).toBe(90000);
  expect(monthBudgetCents(lines, "2026-11", big)).toBe(10000);
});
