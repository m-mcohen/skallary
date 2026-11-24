// @vitest-environment jsdom
// tests/ui/ThisMonthSameDays.test.tsx
//
// This time in this month against this time last month. On the Dashboard's spending card:
// A. under Spent this month, BOTH same-days comparisons at once, last month's and
//    the average month's (the dropdown that showed one of them is gone, and the
//    chart draws both comparison lines, each named in its legend);
// B. each top category also shows its spending by the same day last month, opening
//    that category's ledger for those days.
// A past month shows the same pair in its whole-month form.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("../../src/ui/charts/ChartBase", async () => (await import("./charts/mock-chart-base")).default);
const charts = mockChartBase();

import { mockChartBase } from "./charts/mock-chart-base";
import ThisMonthCard from "../../src/ui/dashboard/ThisMonthCard";
import SpendingChartCard from "../../src/ui/dashboard/SpendingChartCard";
import { TOP_CATEGORIES_KEY } from "../../src/ui/dashboard/TopCategories";
import { formatPeriodLabel } from "../../src/domain/period";
import { resolvePeriod } from "../../src/domain/period";
import { spentMonthToDate, type MonthToDate } from "../../src/domain/compare";
import type { SpendingCurves } from "../../src/domain/spending-curve";
import { parseLedgerQuery } from "../../src/ui/lib/ledger-link";
import { EMPTY_FILTER, filterRows, ledgerTotal, toRows } from "../../src/domain/transactions-view";
import { formatCents } from "../../src/domain/money";
import type { Account, NormalizedTxn } from "../../src/domain/types";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error -- jsdom polyfill for tests only
  global.ResizeObserver = ResizeObserverStub;
});

/**
 * The Dashboard's arrangement now: the chart on its own
 * card, then the spending card. These tests read both, as the Dashboard shows them.
 */
function Dash(props: Parameters<typeof ThisMonthCard>[0]) {
  return (
    <>
      {props.curves && props.spent && (
        <SpendingChartCard curves={props.curves} endedLabel={props.ended ? formatPeriodLabel(props.ended.month) : null} />
      )}
      <ThisMonthCard {...props} />
    </>
  );
}

// Top categories starts folded; these tests read the open list.
beforeEach(() => {
  window.localStorage.setItem(TOP_CATEGORIES_KEY, "open");
  charts.reset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// By hand. Today is Oct 20, 2026.
//   Spent this month $1,500.00. Last month, Sep 1 to 20: $1,200.00, so +$300.00, $300.00 / $1,200.00 = +25.0%.
//   Average month by Day 20: $2,000.00, so -$500.00, -$500.00 / $2,000.00 = -25.0%.
//   Top categories: Rent $1,000.00 (last month $900.00); Gifts $20.00 (nothing last month: $0.00).
const spent: MonthToDate = {
  period: resolvePeriod("this-month", "2026-10-20"),
  cents: 150000,
  baseline: { range: { from: "2026-09-01", to: "2026-09-20" }, cents: 120000, byCategory: { Rent: 90000, Gifts: 0 } },
  leftOverCents: 0,
  savingCents: 0,
  topCategories: [
    { category: "Rent", cents: 100000 },
    { category: "Gifts", cents: 2000 },
  ],
};

const ramp = (length: number, end: number) => Array.from({ length }, (_, i) => Math.round((end * (i + 1)) / length));

const curves: SpendingCurves = {
  month: "2026-10",
  today: 20,
  days: 31,
  thisMonth: ramp(20, 150000),
  lastMonth: ramp(31, 186000), // Day 20 = $1,200.00, Day 31 = $1,860.00
  averageMonth: ramp(31, 310000), // Day 20 = $2,000.00, Day 31 = $3,100.00
  lastMonthLabel: "September",
};

const text = (id: string) => screen.getByTestId(id).textContent ?? "";
const params = (a: Element) => Object.fromEntries(new URLSearchParams(a.getAttribute("href")!.split("?")[1]));

describe("A: both same-days comparisons under Spent this month", () => {
  test("last month's same days and the average month's same days, at once", () => {
    render(<Dash spent={spent} curves={curves} />);
    expect(text("dash-spent-note")).toMatch(/^Through Oct 20\./);
    expect(text("dash-spent-vs-last")).toBe("Last month, same days (Sep 1 to Sep 20): $1,200.00 +$300.00 (+25.0%)");
    expect(text("dash-spent-vs-average")).toBe("12-month average, same days: $2,000.00 -$500.00 (-25.0%)");
    // More spending than last month is unfavorable; less than the average month is favorable.
    expect(screen.getByTestId("dash-spent-change").getAttribute("data-favorable")).toBe("false");
    expect(screen.getByTestId("dash-spent-change-average").getAttribute("data-favorable")).toBe("true");
  });

  test("last month's figure opens its ledger; the average month's is not a link", () => {
    render(<Dash spent={spent} curves={curves} />);
    const link = screen.getByTestId("dash-spent-vs-last").querySelector("a[data-ledger]")!;
    expect(link.textContent).toBe("$1,200.00");
    expect(params(link)).toMatchObject({ label: "Spending, last month, same days", kind: "expense", from: "2026-09-01", to: "2026-09-20", back: "#/dashboard" });
    expect(screen.getByTestId("dash-spent-vs-average").querySelector("a")).toBeNull();
  });

  test("the old last-month-or-average dropdown is gone, and showing the card writes nothing to this browser's storage", () => {
    const get = vi.spyOn(Storage.prototype, "getItem");
    const set = vi.spyOn(Storage.prototype, "setItem");
    window.localStorage.setItem("finance.dashboard.spendCompare", "last"); // a value left from before is ignored
    set.mockClear();
    render(<Dash spent={spent} curves={curves} />);
    const card = screen.getByLabelText("This month so far");
    expect(within(card).queryByRole("combobox")).toBeNull();
    expect(card.querySelector("select")).toBeNull();
    expect(get.mock.calls.some(([k]) => String(k).includes("spendCompare"))).toBe(false);
    expect(set).not.toHaveBeenCalled();
    expect(text("dash-spent-vs-average")).toContain("12-month average, same days");
  });

  test("the chart draws this month and both comparison lines, each named in its legend", () => {
    render(<Dash spent={spent} curves={curves} />);
    const chart = charts.last("Spending by day, this month against September and the average month");
    expect(chart.series.map((s) => s.id)).toEqual(["thisMonth", "lastMonth", "averageMonth"]);
    const legend = screen.getByTestId("spend-chart-legend");
    expect([...legend.children].map((c) => c.textContent)).toEqual(["This month", "September", "Average month (last 12 months)"]);
    expect(text("spend-chart-summary")).toBe(
      "This month so far: $1,500.00 through Day 20. September by Day 20: $1,200.00; by Day 31: $1,860.00. Average month by Day 20: $2,000.00; by Day 31: $3,100.00."
    );
  });

  test("without the history, each says so in the existing words, and the chart draws this month alone", () => {
    render(
      <Dash
        spent={{ ...spent, baseline: null }}
        curves={{ ...curves, lastMonth: null, averageMonth: null }}
      />
    );
    expect(text("dash-spent-vs-last")).toBe("Not enough history to compare with last month.");
    expect(text("dash-spent-vs-average")).toBe("Not enough history to compare with the 12-month average.");
    expect(screen.queryByTestId("month-top-Rent-before")).toBeNull();
    expect(charts.last("Spending by day, this month").series.map((s) => s.id)).toEqual(["thisMonth"]);
    expect([...screen.getByTestId("spend-chart-legend").children].map((c) => c.textContent)).toEqual(["This month"]);
  });
});

describe("B: each top category by the same day last month", () => {
  test("reads its amount, then Last month, opening that category's ledger for last month's same days", () => {
    render(<Dash spent={spent} curves={curves} />);
    const rent = screen.getByTestId("month-top-Rent");
    expect(rent.textContent).toContain("$1,000.00");
    expect(text("month-top-Rent-before")).toBe("Last month: $900.00");
    const link = screen.getByTestId("month-top-Rent-before").querySelector("a[data-ledger]")!;
    expect(link.textContent).toBe("$900.00");
    expect(params(link)).toEqual({
      ledger: "1",
      label: "Rent, last month, same days",
      cat: "Rent",
      kind: "expense",
      from: "2026-09-01",
      to: "2026-09-20",
      counted: "1",
      back: "#/dashboard",
    });
  });

  test("a category with nothing last month reads $0.00, with no link", () => {
    render(<Dash spent={spent} curves={curves} />);
    expect(text("month-top-Gifts-before")).toBe("Last month: $0.00");
    expect(screen.getByTestId("month-top-Gifts-before").querySelector("a")).toBeNull();
  });

  test("on a narrow screen the name gives way and the two figures stay together on the right", () => {
    render(<Dash spent={spent} curves={curves} />);
    const rent = screen.getByTestId("month-top-Rent");
    const [name, figures] = [...rent.children];
    expect(name.className).toMatch(/\btruncate\b/);
    expect(name.className).toMatch(/\bmin-w-0\b/);
    expect(figures.className).toMatch(/\bshrink-0\b/);
    expect(figures.contains(screen.getByTestId("month-top-Rent-before"))).toBe(true);
  });

  test("each last-month figure equals the sum of the rows its ledger lists", () => {
    const accounts = [
      { id: "a", name: "A", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
      { id: "x", name: "X", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "me" },
    ] as Account[];
    const t = (id: string, date: string, amountCents: number, sourceCategory: string, over: Partial<NormalizedTxn> = {}) =>
      ({ sourceTransactionId: id, accountId: "a", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over }) as NormalizedTxn;
    // By hand, Oct 1 to 20 against Sep 1 to 20: Groceries $230.00 ($250.00 + $10.00 - $30.00 refund; the 21st's
    // $888.00 is out); Dining $40.00 (the $70.00 on an account not counted is out); Gifts $0.00.
    const txns = [
      t("o1", "2026-10-02", -40000, "Groceries"),
      t("o2", "2026-10-03", -5000, "Dining"),
      t("o3", "2026-10-04", -2000, "Gifts"),
      t("s1", "2026-09-05", -25000, "Groceries"),
      t("s2", "2026-09-20", -1000, "Groceries"),
      t("s3", "2026-09-21", -88800, "Groceries"),
      t("s4", "2026-09-10", 3000, "Groceries"),
      t("s5", "2026-09-15", -4000, "Dining"),
      t("s6", "2026-09-20", -7000, "Dining", { accountId: "x" }),
      t("old", "2026-08-01", -1, "Groceries"),
    ];
    render(<Dash spent={spentMonthToDate(txns, accounts, {}, "2026-10-20")} curves={null} />);
    const shown: Record<string, string> = {};
    for (const category of ["Groceries", "Dining", "Gifts"]) {
      const before = screen.getByTestId(`month-top-${category}-before`);
      const a = before.querySelector("a[data-ledger]");
      const fromLedger = a
        ? ledgerTotal(filterRows(toRows(txns, accounts, {}), { ...EMPTY_FILTER, ...parseLedgerQuery(new URLSearchParams(a.getAttribute("href")!.split("?")[1])).initialFilter })).expenseCents
        : 0;
      expect(before.textContent, category).toBe(`Last month: ${formatCents(fromLedger)}`);
      shown[category] = before.textContent!;
    }
    expect(shown).toEqual({ Groceries: "Last month: $230.00", Dining: "Last month: $40.00", Gifts: "Last month: $0.00" });
  });
});

describe("a past month: the same pair, whole month against whole month", () => {
  // By hand: August $315.00 against all of July $175.00: +$140.00, $140.00 / $175.00 = +80.0%.
  //   The whole average month (Day 31) $3,100.00: -$2,785.00, -$2,785.00 / $3,100.00 = -89.8%.
  //   Rent in August $200.00, in July $150.00; Groceries $115.00, nothing in July: $0.00.
  const aug: MonthToDate = {
    period: resolvePeriod("this-month", "2026-08-31"),
    cents: 31500,
    baseline: { range: { from: "2026-07-01", to: "2026-07-31" }, cents: 17500, byCategory: { Rent: 15000, Groceries: 0 } },
    leftOverCents: 0,
    savingCents: 0,
    topCategories: [
      { category: "Rent", cents: 20000 },
      { category: "Groceries", cents: 11500 },
    ],
  };
  const augCurves: SpendingCurves = {
    month: "2026-08",
    today: 31,
    days: 31,
    thisMonth: ramp(31, 31500),
    lastMonth: ramp(31, 17500),
    averageMonth: ramp(31, 310000),
    lastMonthLabel: "July",
  };
  const ended = { month: "2026-08", budget: { budgetCents: 0, spentCents: 31500, differenceCents: -31500 }, back: "#/dashboard?month=2026-08" };

  test("the month before in full and the average month in full", () => {
    render(<Dash spent={aug} curves={augCurves} ended={ended} />);
    expect(text("dash-spent-note")).toMatch(/^Aug 1 to Aug 31\./);
    expect(text("dash-spent-vs-last")).toBe("July, whole month: $175.00 +$140.00 (+80.0%)");
    expect(text("dash-spent-vs-average")).toBe("12-month average: $3,100.00 -$2,785.00 (-89.8%)");
    const link = screen.getByTestId("dash-spent-vs-last").querySelector("a[data-ledger]")!;
    expect(params(link)).toMatchObject({ label: "Spending, July 2026", from: "2026-07-01", to: "2026-07-31", back: "#/dashboard?month=2026-08" });
    expect(screen.getByTestId("dash-spent-vs-average").querySelector("a")).toBeNull();
    expect(screen.getByLabelText("Spending, August 2026").querySelector("select")).toBeNull();
  });

  test("each top category shows the month before in full, and Back returns to the month", () => {
    render(<Dash spent={aug} curves={augCurves} ended={ended} />);
    expect(text("month-top-Rent-before")).toBe("July: $150.00");
    const link = screen.getByTestId("month-top-Rent-before").querySelector("a[data-ledger]")!;
    expect(params(link)).toMatchObject({ label: "Rent, July 2026", cat: "Rent", kind: "expense", from: "2026-07-01", to: "2026-07-31", back: "#/dashboard?month=2026-08" });
    expect(text("month-top-Groceries-before")).toBe("July: $0.00");
    expect(screen.getByTestId("month-top-Groceries-before").querySelector("a")).toBeNull();
  });

  test("the chart names both whole months", () => {
    render(<Dash spent={aug} curves={augCurves} ended={ended} />);
    const chart = charts.last("Spending by day, August 2026 against July and the average month");
    expect(chart.series.map((s) => s.id)).toEqual(["thisMonth", "lastMonth", "averageMonth"]);
    expect(text("spend-chart-summary")).toBe("August 2026: $315.00 for the whole month. July, whole month: $175.00. Average month, whole month: $3,100.00.");
  });

  test("without the history, the past month says so for each", () => {
    render(<Dash spent={{ ...aug, baseline: null }} curves={{ ...augCurves, lastMonth: null, averageMonth: null }} ended={ended} />);
    expect(text("dash-spent-vs-last")).toBe("Not enough history to compare with the month before.");
    expect(text("dash-spent-vs-average")).toBe("Not enough history to compare with the 12-month average.");
  });
});
