// tests/domain/report-view.test.ts
// Reports reads every Spending figure from one list of entries, so the ranked list,
// the chart and the monthly table cannot disagree. Refunds sit on their own line and
// the net total must still equal today's total to the cent.
import { describe, expect, test } from "vitest";
import {
  REFUNDS_LABEL,
  bucketsFor,
  chartRows,
  daysInRange,
  flowBaseline,
  completeMonths,
  groupingFor,
  monthlyAverage,
  reportEntries,
  reportRange,
  spendingView,
} from "../../src/domain/report-view";
import { rollupMonthly } from "../../src/domain/rollups";
import { spendingByCategoryOverTime } from "../../src/domain/reports";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const accounts = [
  { id: "a1", name: "JOINT", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  { id: "a9", name: "NOT COUNTED", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "me" },
] as Account[];

const t = (id: string, date: string, amountCents: number, sourceCategory: string, over: Partial<NormalizedTxn> = {}) =>
  ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over }) as NormalizedTxn;

// A month where a big return on a shopping category outweighs that month's purchases on it,
// so the category would read negative.
const txns: NormalizedTxn[] = [
  t("shop-buy", "2026-04-03", -10000, "Shopping"), // spent $100.00
  t("shop-return", "2026-04-20", 500000, "Shopping"), // $5,000.00 came back
  t("groc-apr", "2026-04-10", -45000, "Groceries"), // $450.00
  t("groc-refund", "2026-04-11", 2000, "Groceries"), // $20.00 came back
  t("groc-may", "2026-05-02", -30000, "Groceries"), // $300.00
  t("dining-may", "2026-05-05", -12000, "Dining"), // $120.00
  t("moved", "2026-05-06", -55500, "Groceries", { isTransfer: true }), // a transfer: not spending
  t("uncounted", "2026-05-07", -77700, "Groceries", { accountId: "a9" }), // account not counted
  t("pay", "2026-05-15", 900000, "Paychecks"), // the other side
];
const entries = reportEntries(txns, accounts, {}, "expense");

describe("refunds and credits on their own line", () => {
  test("no category reads negative, and the net total equals today's total to the cent", () => {
    // Today (one figure per category, refunds netted in):
    //   Shopping   100.00 - 5,000.00          = -4,900.00
    //   Groceries  450.00 - 20.00 + 300.00    =    730.00
    //   Dining     120.00                     =    120.00
    //   Total                                 = -4,050.00
    const today = spendingByCategoryOverTime(rollupMonthly(txns, accounts, {}));
    const todayTotal = today.series.reduce((sum, s) => sum + s.total, 0);
    expect(todayTotal).toBe(-405000);

    // After: each category is what was spent on it; what came back is one line.
    //   Groceries  450.00 + 300.00 = 750.00
    //   Dining                       120.00
    //   Shopping                     100.00
    //   Purchases                    970.00
    //   Refunds and credits  -(5,000.00 + 20.00) = -5,020.00
    //   Total      970.00 - 5,020.00 = -4,050.00, the same to the cent
    const view = spendingView(entries, { from: "2026-04-01", to: "2026-05-31" }, true);
    expect(view.lines.map((l) => [l.category, l.total])).toEqual([
      ["Groceries", 75000],
      ["Dining", 12000],
      ["Shopping", 10000],
    ]);
    expect(view.lines.every((l) => l.total >= 0 && Object.values(l.byMonth).every((c) => c >= 0))).toBe(true);
    expect(view.purchasesCents).toBe(97000);
    expect(view.refunds?.category).toBe(REFUNDS_LABEL);
    expect(view.refunds?.total).toBe(-502000);
    expect(view.totalCents).toBe(todayTotal);
    expect(view.lines.reduce((sum, l) => sum + l.total, 0) + view.refunds!.total).toBe(todayTotal);
  });

  test("each month reconciles too: April 550.00 - 5,020.00 = -4,470.00; May 300.00 + 120.00 = 420.00", () => {
    const view = spendingView(entries, { from: "2026-04-01", to: "2026-05-31" }, true);
    const today = spendingByCategoryOverTime(rollupMonthly(txns, accounts, {}));
    for (const month of ["2026-04", "2026-05"]) {
      const after = view.lines.reduce((sum, l) => sum + (l.byMonth[month] ?? 0), 0) + (view.refunds?.byMonth[month] ?? 0);
      const before = today.totals.find((m) => m.period === month)!.expenseCents;
      expect(after, month).toBe(before);
      expect(view.totalByMonth[month], month).toBe(before);
    }
    expect(view.totalByMonth["2026-04"]).toBe(-447000);
    expect(view.totalByMonth["2026-05"]).toBe(42000);
  });

  test("Income keeps refunds netted in its categories (the split is for spending only)", () => {
    const income = reportEntries([t("pay", "2026-05-15", 900000, "Paychecks"), t("clawback", "2026-05-20", -5000, "Paychecks")], accounts, {}, "income");
    const view = spendingView(income, { from: "2026-05-01", to: "2026-05-31" }, false);
    expect(view.lines.map((l) => [l.category, l.total])).toEqual([["Paychecks", 895000]]);
    expect(view.refunds).toBeNull();
    expect(view.totalCents).toBe(895000);
  });

  test("the months listed are every month of the range, none missing", () => {
    const view = spendingView(entries, { from: "2026-03-15", to: "2026-06-02" }, true);
    expect(view.months).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);
  });
});

describe("the range a report covers", () => {
  test("a period's own dates, with an open end running to today and an open start to the month the history begins in", () => {
    expect(reportRange({ preset: "custom", from: "2026-07-01", to: "2026-08-15" }, "2020-01-01", "2026-10-02")).toEqual({ from: "2026-07-01", to: "2026-08-15" });
    expect(reportRange({ preset: "all", from: null, to: null }, "2025-03-04", "2026-10-02")).toEqual({ from: "2025-03-01", to: "2026-10-02" });
  });

  test("a period that starts months before the history starts with the history's month, so the average is not diluted", () => {
    expect(reportRange({ preset: "last-12", from: "2025-11-01", to: "2026-10-02" }, "2026-02-10", "2026-10-02")).toEqual({ from: "2026-02-01", to: "2026-10-02" });
    // A few days short of the period's start changes nothing.
    expect(reportRange({ preset: "custom", from: "2026-06-01", to: "2026-08-31" }, "2026-06-05", "2026-10-02")).toEqual({ from: "2026-06-01", to: "2026-08-31" });
  });

  test("no history, no range", () => {
    expect(reportRange({ preset: "all", from: null, to: null }, null, "2026-10-02")).toBeNull();
  });

  // A monthly average covers completed months only: counting partial months would
  // change the average every day.
  test("the monthly average divides by complete months only; the unfinished month stays in the total", () => {
    // Today Oct 2, 2026; the period runs Aug 1 to Oct 2. August $300.00, September $600.00,
    // October so far $99.99. Total 999.99; average (300.00 + 600.00) / 2 = 450.00.
    // Counting October by its days (2/31 of a month) would read 999.99 / 2.0645 = 484.37.
    const byMonth = { "2026-08": 30000, "2026-09": 60000, "2026-10": 9999 };
    const got = monthlyAverage(byMonth, { from: "2026-08-01", to: "2026-10-02" }, "2026-10-02");
    expect(got.months).toEqual(["2026-08", "2026-09"]);
    expect(got.averageCents).toBe(45000);
  });

  test("a month the period cuts short at the start is left out too; none complete means no average", () => {
    // Jul 15 to Sep 30, today Oct 2: July is cut short, so Aug and Sep. 200.00 + 101.00 = 301.00 / 2 = 150.50.
    expect(monthlyAverage({ "2026-07": 50000, "2026-08": 20000, "2026-09": 10100 }, { from: "2026-07-15", to: "2026-09-30" }, "2026-10-02")).toEqual({
      months: ["2026-08", "2026-09"],
      averageCents: 15050,
    });
    // A month that ends today is not over yet.
    expect(monthlyAverage({ "2026-09": 1000 }, { from: "2026-09-01", to: "2026-09-30" }, "2026-09-30")).toEqual({ months: [], averageCents: null });
    expect(completeMonths({ from: "2026-09-01", to: "2026-09-30" }, "2026-10-01")).toEqual(["2026-09"]);
  });
});

describe("chart grouping fits the range", () => {
  test("days counted inclusive", () => {
    expect(daysInRange({ from: "2026-01-01", to: "2026-01-01" })).toBe(1);
    expect(daysInRange({ from: "2026-01-01", to: "2026-01-31" })).toBe(31);
  });

  test("31 days is by day; 32 is by week", () => {
    expect(groupingFor({ from: "2026-01-01", to: "2026-01-31" })).toBe("day");
    expect(groupingFor({ from: "2026-01-01", to: "2026-02-01" })).toBe("week");
  });

  test("186 days is by week; 187 is by month", () => {
    // Jan 1 to Jun 30 is 181 days; Jul 1 to Jul 5 makes 186.
    expect(daysInRange({ from: "2026-01-01", to: "2026-07-05" })).toBe(186);
    expect(groupingFor({ from: "2026-01-01", to: "2026-07-05" })).toBe("week");
    expect(groupingFor({ from: "2026-01-01", to: "2026-07-06" })).toBe("month");
  });

  test("by day: every day, including days with nothing", () => {
    const days = bucketsFor({ from: "2026-08-30", to: "2026-09-02" }, "day");
    expect(days.map((b) => [b.key, b.from, b.to])).toEqual([
      ["2026-08-30", "2026-08-30", "2026-08-30"],
      ["2026-08-31", "2026-08-31", "2026-08-31"],
      ["2026-09-01", "2026-09-01", "2026-09-01"],
      ["2026-09-02", "2026-09-02", "2026-09-02"],
    ]);
  });

  test("by week: Sunday to Saturday, the first and last weeks cut at the range", () => {
    // Aug 1, 2026 is a Saturday; Aug 2 a Sunday.
    const weeks = bucketsFor({ from: "2026-08-01", to: "2026-08-20" }, "week");
    expect(weeks.map((b) => [b.from, b.to])).toEqual([
      ["2026-08-01", "2026-08-01"],
      ["2026-08-02", "2026-08-08"],
      ["2026-08-09", "2026-08-15"],
      ["2026-08-16", "2026-08-20"],
    ]);
  });

  test("by month: month keys, cut at the range", () => {
    const months = bucketsFor({ from: "2026-07-15", to: "2026-09-02" }, "month");
    expect(months.map((b) => [b.key, b.from, b.to])).toEqual([
      ["2026-07", "2026-07-15", "2026-07-31"],
      ["2026-08", "2026-08-01", "2026-08-31"],
      ["2026-09", "2026-09-01", "2026-09-02"],
    ]);
  });

  test("chart rows add each entry to its bucket under the key it is given, and never invent keys", () => {
    const buckets = bucketsFor({ from: "2026-04-01", to: "2026-05-31" }, "month");
    const rows = chartRows(entries, buckets, (e) => (e.cents < 0 ? "refunds" : e.category === "Groceries" ? "s0" : "rest"));
    // April: Groceries 450.00; rest 100.00 (Shopping); refunds -5,020.00
    // May:   Groceries 300.00; rest 120.00 (Dining)
    expect(rows).toEqual([
      { period: "2026-04", s0: 45000, rest: 10000, refunds: -502000 },
      { period: "2026-05", s0: 30000, rest: 12000 },
    ]);
  });
});

describe("a comparison baseline split the same way", () => {
  test("purchases per category, refunds and the net total, summed over the baseline's ranges", () => {
    const base = flowBaseline(entries, [{ from: "2026-04-01", to: "2026-04-30" }], true);
    expect(base.raw.get("Groceries")).toBe(45000);
    expect(base.raw.get("Shopping")).toBe(10000);
    expect(base.refundsRaw).toBe(-502000);
    // 450.00 + 100.00 - 5,020.00 = -4,470.00
    expect(base.totalRaw).toBe(-447000);
  });
});

describe("the maaser pot on Reports: gifts list as rows, the pot's moves never do", () => {
  const POT: Account = { id: "pot", name: "Giving", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me", maaserPot: true };
  let k = 0;
  const row = (accountId: string, date: string, amountCents: number, sourceCategory: string | null, over: Partial<NormalizedTxn> = {}): NormalizedTxn => ({
    sourceTransactionId: `pot${++k}`, accountId, date, amountCents, sourceCategory, merchant: "Local Charity", isTransfer: false, sourceUpdatedAt: null, ...over,
  });
  const prepared = [
    row("pot", "2026-10-02", 150000, "Maaser"),
    row("a1", "2026-10-08", -60000, "Charity"),
    row("pot", "2026-10-15", -5000, "Transfer", { isTransfer: true, transferPartnerAccountId: "a1" }),
    row("a1", "2026-10-15", 5000, "Transfer", { isTransfer: true, transferPartnerAccountId: "pot" }),
    row("pot", "2026-10-18", -50000, null, { merchant: "Zelle payment to A Charity", description: "ZELLE PAYMENT TO A CHARITY" }),
    row("pot", "2026-10-20", -250000, null, { merchant: "ATM withdrawal" }),
    row("a1", "2026-10-12", -3000, "Groceries"),
    row("pot", "2026-10-30", 5, "Interest"),
  ];
  test("Charity entries are the card gift and the two gifts from the pot, under the bank's own words, and add up to the rollup", () => {
    const entries = reportEntries(prepared, [...accounts, POT], {}, "expense", (t) => t.merchant ?? "");
    expect(entries.filter((e) => e.category === "Charity").map((e) => [e.date, e.cents, e.merchant])).toEqual([
      ["2026-10-08", 60000, "Local Charity"], ["2026-10-18", 50000, "Zelle payment to A Charity"], ["2026-10-20", 250000, "ATM withdrawal"],
    ]);
    expect(entries.filter((e) => e.category === "Charity").reduce((s, e) => s + e.cents, 0)).toBe(rollupMonthly(prepared, [...accounts, POT], {}).find((r) => r.planningCategory === "Charity")!.amountCents);
    expect(entries.some((e) => /maaser/i.test(e.merchant ?? ""))).toBe(false);
  });
  test("the pot's rows never land on Income; without a pot the gift lists as before", () => {
    expect(reportEntries(prepared, [...accounts, POT], {}, "income")).toEqual([]);
    expect(reportEntries(prepared, [...accounts, { ...POT, maaserPot: false }], {}, "expense").find((e) => e.category === "Charity")?.cents).toBe(60000);
  });
});
