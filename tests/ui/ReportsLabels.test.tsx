// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportsSection from "../../src/ui/ReportsSection";
import { customPeriod, resolvePeriod } from "../../src/domain/period";
import { EMPTY_FILTER, filterRows, ledgerTotal, toRows } from "../../src/domain/transactions-view";
import { parseLedgerQuery } from "../../src/ui/lib/ledger-link";
import { formatCents } from "../../src/domain/money";
import type { NormalizedTxn } from "../../src/domain/types";

import { mockChartBase } from "./charts/mock-chart-base";

vi.mock("../../src/ui/charts/ChartBase", async () => (await import("./charts/mock-chart-base")).default);
const charts = mockChartBase();

beforeEach(() => charts.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

/** The comparison line the chart was last given, as [month, cents] pairs; undefined when it has none. */
function baseline(): [string, number | null][] | undefined {
  const chart = charts.calls.filter((c) => c.title === "Spending by month").at(-1);
  return chart?.series.find((s) => s.id === "__baseline")?.points.map((pt) => [pt.x, pt.cents]);
}

const txn = (category: string, cents: number, date = "2026-08-10"): NormalizedTxn => ({
  sourceTransactionId: `${category}-${date}`, accountId: "missing", date,
  amountCents: -cents, sourceCategory: category, merchant: null, isTransfer: false, sourceUpdatedAt: null,
});
const layer = (transactions: NormalizedTxn[]) => ({
  loadDb: async () => ({ base: "" }), getTransactions: async () => transactions,
  getAccounts: async () => [], getRules: async () => [], getAdjustments: async () => [], getCategoryMappings: async () => ({}),
});
const august = customPeriod("2026-08-01", "2026-08-31");

const chartHistory = Array.from({ length: 57 }, (_, i) => {
  const month = `${2022 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`;
  return [txn("Food", 100, `${month}-01`), txn("Food", 100, `${month}-20`), txn("Food", 900, `${month}-21`)];
}).flat();

test.each(["previous", "last-year", "avg-3", "avg-12"] as const)("the %s chart baseline follows every preset", async (compare) => {
  for (const preset of ["this-month", "last-month", "this-quarter", "last-3", "last-12", "ytd", "last-year", "all"] as const) {
    charts.reset();
    render(<ReportsSection period={resolvePeriod(preset, "2026-09-20")} compare={compare} categories={[]} dataLayer={layer(chartHistory)} />);
    await screen.findByTestId("report-grand-total");
    // The comparison marker is drawn when the chart is by month, so ask for months.
    await userEvent.setup().click(screen.getByRole("button", { name: "Month" }));
    if (preset === "all") {
      expect(baseline()).toBeUndefined();
    } else {
      const months = preset === "this-month" ? ["2026-09"] : preset === "last-month" ? ["2026-08"]
        : preset === "last-year" ? Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`)
        : preset === "last-12" ? ["2025-10", "2025-11", "2025-12", ...Array.from({ length: 9 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`)]
        : preset === "ytd" ? Array.from({ length: 9 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`)
        : ["2026-07", "2026-08", "2026-09"];
      expect(baseline(), preset).toEqual(months.map((month) => [month, month === "2026-09" ? 200 : 1100]));
    }
    cleanup();
  }
});

test.each([false, true])("a real Other category opens its own ledger with folding set to %s", async (folding) => {
  const transactions = [txn("Other", 10000), ...Array.from({ length: folding ? 9 : 1 }, (_, i) => txn(`Category ${i}`, 100 + i))];
  render(<ReportsSection period={august} compare="none" categories={[]} dataLayer={layer(transactions)} />);
  const cells = await screen.findAllByTestId("report-total-Other");
  const own = cells.find((cell) => cell.textContent === "$100.00")!;
  const parsed = parseLedgerQuery(new URLSearchParams(own.querySelector("a")!.getAttribute("href")!.split("?")[1]));
  expect(parsed.initialFilter.categories).toEqual(["Other"]);
  const rows = toRows(transactions, [], {});
  for (const cell of cells) {
    const filter = parseLedgerQuery(new URLSearchParams(cell.querySelector("a")!.getAttribute("href")!.split("?")[1])).initialFilter;
    expect(cell.textContent).toBe(formatCents(ledgerTotal(filterRows(rows, { ...EMPTY_FILTER, ...filter })).expenseCents));
  }
  // 31 days draw by day; everything here is on the 10th.
  const bars = screen.getAllByRole("button", { name: "Other 2026-08-10" });
  expect(bars.map((bar) => bar.textContent)).toEqual(folding ? ["10000", "201"] : ["10000"]);
});

test("category names cannot replace the chart month or baseline values", async () => {
  const transactions = [txn("period", 100), txn("__baseline", 200), txn("123", 300), txn("", 400), txn("A|expense", 500), txn("old", 700, "2026-07-01")];
  render(<ReportsSection period={august} compare="previous" categories={[]} dataLayer={layer(transactions)} />);
  await screen.findByTestId("report-grand-total");
  // 31 days draw by day, and clicking a day lists that day's transactions:
  // 100 + 200 + 300 + 400 + 500 on Aug 10.
  for (const [name, cents] of [["period", 100], ["__baseline", 200], ["123", 300], ["", 400], ["A|expense", 500]] as const) {
    const bar = screen.getByRole("button", { name: `${name} 2026-08-10`.trim() });
    expect(bar.textContent).toBe(String(cents));
    fireEvent.click(bar);
    const filter = parseLedgerQuery(new URLSearchParams(window.location.hash.split("?")[1])).initialFilter;
    expect(filter.categories).toBeUndefined();
    expect(filter.from).toBe("2026-08-10");
    expect(filter.to).toBe("2026-08-10");
    expect(ledgerTotal(filterRows(toRows(transactions, [], {}), { ...EMPTY_FILTER, ...filter })).expenseCents).toBe(1500);
  }
  // A category name cannot replace a total either: each ranked total is its own.
  for (const [name, cents] of [["period", 100], ["__baseline", 200], ["123", 300], ["", 400], ["A|expense", 500]] as const) {
    expect(screen.getByTestId(`rank-total-${name}`).textContent).toBe(`$${(cents / 100).toFixed(2)}`);
  }
  await userEvent.setup().click(screen.getByRole("button", { name: "Month" }));
  expect(baseline()).toEqual([["2026-08", 700]]);
});
