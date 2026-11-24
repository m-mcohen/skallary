// @vitest-environment jsdom
// tests/ui/ReportsLayout.test.tsx
//
// Reports answers "where did the
// money go" first. Decision 12 (items 1 to 6) and the late amendment (items 7 to 9):
// the period total and a ranked list first, "Other" opens, refunds on their own
// line, the monthly table below with Category and Total pinned, a chart whose
// grouping fits the period and drills down, stacked or regular columns, and
// narrowing to chosen budget lines.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportsSection from "../../src/ui/ReportsSection";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import { customPeriod } from "../../src/domain/period";
import { formatCents } from "../../src/domain/money";
import { prepareTransactions } from "../../src/domain/pipeline";
import { rollupMonthly } from "../../src/domain/rollups";
import { spendingByCategoryOverTime } from "../../src/domain/reports";
import { EMPTY_FILTER, filterRows, ledgerTotal, toRows } from "../../src/domain/transactions-view";
import { parseLedgerQuery } from "../../src/ui/lib/ledger-link";
import { configurePeriodStore } from "../../src/ui/lib/period-store";

import { mockChartBase } from "./charts/mock-chart-base";

vi.mock("../../src/ui/charts/ChartBase", async () => (await import("./charts/mock-chart-base")).default);
const charts = mockChartBase();

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = ResizeObserverStub;
});
beforeEach(() => {
  window.localStorage.clear();
  configurePeriodStore({ asOf: () => "2026-10-02" });
});
beforeEach(() => charts.reset());
afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const accounts = [
  { id: "a1", name: "JOINT", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
] as Account[];
const t = (id: string, date: string, amountCents: number, sourceCategory: string) =>
  ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null }) as NormalizedTxn;

// June to August 2026. Shopping nets NEGATIVE today ($100.00 spent, $150.00 back).
const txns: NormalizedTxn[] = [
  t("rent-jun", "2026-06-05", -150000, "Rent"),
  t("rent-jul", "2026-07-05", -150000, "Rent"),
  t("rent-aug", "2026-08-05", -150000, "Rent"),
  t("groc-jun", "2026-06-12", -30000, "Groceries"),
  t("groc-jul", "2026-07-12", -40000, "Groceries"),
  t("groc-aug", "2026-08-12", -50000, "Groceries"),
  t("groc-back", "2026-08-13", 2500, "Groceries"),
  t("shop-jul", "2026-07-20", -10000, "Shopping"),
  t("shop-back", "2026-08-20", 15000, "Shopping"),
  t("dining-aug", "2026-08-21", -12345, "Dining"),
  t("pay-aug", "2026-08-15", 800000, "Paychecks"),
];
const layer = (list: NormalizedTxn[] = txns) => ({
  loadDb: async () => ({ base: "" }),
  getTransactions: async () => list,
  getAccounts: async () => accounts,
  getRules: async () => [],
  getAdjustments: async () => [],
  getCategoryMappings: async () => ({}),
});
const summer = customPeriod("2026-06-01", "2026-08-31"); // 92 days: by week
const august = customPeriod("2026-08-01", "2026-08-31"); // 31 days: by day
const text = (id: string) => screen.getByTestId(id).textContent;
const rankNames = () => [...document.querySelectorAll("[data-rank-row]")].map((r) => r.getAttribute("data-rank-row"));
const allRows = toRows(prepareTransactions(txns, { rules: [], adjustments: [] }), accounts, {});
const landed = (href: string) => {
  const parsed = parseLedgerQuery(new URLSearchParams(href.slice(href.indexOf("?") + 1)));
  return { parsed, total: ledgerTotal(filterRows(allRows, { ...EMPTY_FILTER, ...parsed.initialFilter })) };
};
const barKeys = (series: string) =>
  screen.getAllByRole("button", { name: new RegExp(`^${series} `) }).map((b) => b.getAttribute("aria-label")!.slice(series.length + 1));

describe("the period total and the ranked list come first (items 1 and 3)", () => {
  test("the total spent equals today's total to the cent, with purchases and refunds behind it", async () => {
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    // Today: Rent 4,500.00 + Groceries 1,175.00 + Shopping -50.00 + Dining 123.45 = 5,748.45
    const today = spendingByCategoryOverTime(rollupMonthly(txns, accounts, {})).series.reduce((sum, s) => sum + s.total, 0);
    expect(today).toBe(574845);
    expect(text("summary-total")).toBe(formatCents(574845));
    // Purchases 4,500.00 + 1,200.00 + 100.00 + 123.45 = 5,923.45; back 25.00 + 150.00 = 175.00
    expect(text("summary-purchases")).toBe(formatCents(592345));
    expect(text("summary-refunds")).toBe(formatCents(17500));
    // Three whole months: 5,748.45 / 3 = 1,916.15
    expect(text("summary-average")).toBe(formatCents(191615));
  });

  test("ranked by total, each with its share of purchases and its monthly average; refunds on their own line", async () => {
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(rankNames()).toEqual(["Rent", "Groceries", "Dining", "Shopping", "Refunds and credits"]);
    // Shopping reads what was spent on it, never -$50.00.
    expect(text("rank-total-Shopping")).toBe(formatCents(10000));
    expect(text("rank-total-Groceries")).toBe(formatCents(120000));
    expect(text("rank-total-Refunds and credits")).toBe(formatCents(-17500));
    expect(text("rank-grand-total")).toBe(formatCents(574845));
    // Shares of 5,923.45: Rent 75.97% -> 76%; Groceries 20.26% -> 20%; Dining 2.08% -> 2%; Shopping 1.69% -> 2%
    expect(text("rank-share-Rent")).toBe("76%");
    expect(text("rank-share-Groceries")).toBe("20%");
    expect(text("rank-share-Dining")).toBe("2%");
    expect(text("rank-share-Shopping")).toBe("2%");
    // Monthly averages over 3 months: 1,500.00; 400.00; 41.15; 33.33; refunds -58.33
    expect(text("rank-avg-Rent")).toBe(formatCents(150000));
    expect(text("rank-avg-Groceries")).toBe(formatCents(40000));
    expect(text("rank-avg-Dining")).toBe(formatCents(4115));
    expect(text("rank-avg-Shopping")).toBe(formatCents(3333));
    expect(text("rank-avg-Refunds and credits")).toBe(formatCents(-5833));
    // Money rule: spending is not an overspend, so nothing here is red.
    expect(document.querySelector("[data-testid='ranked-list'] .text-destructive")).toBeNull();
  });

  test("the ranked list sits above the monthly table", async () => {
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    const ranked = await screen.findByTestId("ranked-list");
    const monthly = screen.getByTestId("monthly-table");
    expect(ranked.compareDocumentPosition(monthly) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("every figure in the ranked list and the monthly table opens a ledger that adds up to it", async () => {
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    const links = [...document.querySelectorAll("table a[data-ledger]")].filter((l) => !l.getAttribute("data-testid")?.startsWith("report-link-"));
    expect(links.length).toBeGreaterThanOrEqual(20);
    for (const link of links) {
      const { parsed, total } = landed(link.getAttribute("href")!);
      expect(parsed.initialFilter.kind).toBe("expense");
      expect(link.textContent, link.getAttribute("href")!).toBe(formatCents(total.expenseCents));
    }
    const refunds = landed(screen.getByTestId("rank-total-Refunds and credits").querySelector("a")!.getAttribute("href")!);
    expect(refunds.parsed.initialFilter.flow).toBe("in");
    expect(refunds.parsed.ledger?.label).toBe("Refunds and credits");
    const shopping = landed(screen.getByTestId("rank-total-Shopping").querySelector("a")!.getAttribute("href")!);
    expect(shopping.parsed.initialFilter).toMatchObject({ categories: ["Shopping"], flow: "out" });
  });
});

describe("Other opens into the categories folded into it", () => {
  const ELEVEN = ["Rent", "Groceries", "Dining", "Utilities", "Gas", "Insurance", "Kids", "Travel", "Gifts", "Pets", "Hobbies"];
  const many = ELEVEN.map((c, i) => t(`x-${i}`, "2026-08-10", -(120000 - i * 9000), c));

  test("closed at first; open, it lists each folded category with its own figures", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer(many)} period={august} compare="none" categories={[]} />);
    const toggle = await screen.findByRole("button", { name: /Other \(3 categories\)/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(rankNames()).not.toContain("Pets");
    // Gifts 120,000 - 8 x 9,000 = 48,000; Pets 39,000; Hobbies 30,000: Other = 117,000
    expect(text("rank-total-Other")).toBe(formatCents(117000));
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(rankNames()).toEqual(expect.arrayContaining(["Gifts", "Pets", "Hobbies"]));
    expect(text("rank-total-Pets")).toBe(formatCents(39000));
  });
});

describe("the monthly table moves below, Category and Total pinned (items 4 and 5)", () => {
  test("refunds have their own row there too, and the months add up to the same total", async () => {
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("monthly-table");
    expect(text("cell-Groceries-2026-08")).toBe(formatCents(50000));
    expect(text("cell-Refunds and credits-2026-08")).toBe(formatCents(-17500));
    // August total is the sum of its four cells, below July and June.
    expect(text("month-total-2026-08")).toBe(formatCents(194845));
    expect(text("month-total-2026-07")).toBe(formatCents(200000));
    expect(text("month-total-2026-06")).toBe(formatCents(180000));
    expect(text("report-grand-total")).toBe(formatCents(574845));
  });

  test("Total is pinned to the right edge and Category to the left, so Total shows without a sideways scroll", async () => {
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    const table = await screen.findByTestId("monthly-table");
    const head = within(table).getByRole("columnheader", { name: "Total" });
    expect(head.className).toMatch(/\bsticky\b/);
    expect(head.className).toMatch(/\bright-0\b/);
    for (const cell of [screen.getByTestId("report-total-Rent"), screen.getByTestId("report-grand-total")]) {
      expect(cell.className).toMatch(/\bsticky\b/);
      expect(cell.className).toMatch(/\bright-0\b/);
    }
    const category = within(table).getByRole("columnheader", { name: "Category" });
    expect(category.className).toMatch(/\bsticky\b/);
    expect(category.className).toMatch(/\bleft-0\b/);
  });

  test("the month the period ends inside is still marked", async () => {
    render(<ReportsSection dataLayer={layer()} period={customPeriod("2026-06-01", "2026-08-20")} compare="none" categories={[]} />);
    await screen.findByTestId("monthly-table");
    expect(screen.getAllByText("Aug 2026 (through Aug 20)").length).toBeGreaterThan(0);
  });
});

describe("the chart's grouping fits the period, and drills down", () => {
  test("31 days is drawn by day; 92 days by week (Sunday start); a menu overrides", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ReportsSection dataLayer={layer()} period={august} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    const days = barKeys("Rent");
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("2026-08-01");
    expect(screen.getByRole("button", { name: "Day" }).getAttribute("aria-pressed")).toBe("true");
    unmount();

    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    // Jun 1, 2026 is a Monday: Jun 1-6, then Sunday weeks from Jun 7 to Aug 30 (13 of them).
    const weeks = barKeys("Rent");
    expect(weeks).toHaveLength(14);
    expect(weeks.slice(0, 2)).toEqual(["2026-06-01", "2026-06-07"]);
    expect(weeks[13]).toBe("2026-08-30");
    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Month" }));
    expect(barKeys("Rent")).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(screen.getByRole("button", { name: "Rent 2026-08" }).textContent).toBe("150000");
  });

  test("clicking a month bar redraws that month by day, and Back returns to the period", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    await user.click(screen.getByRole("button", { name: "Month" }));
    await user.click(screen.getByRole("button", { name: "Groceries 2026-07" }));
    const days = barKeys("Groceries");
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("2026-07-01");
    expect(days[30]).toBe("2026-07-31");
    // July 12: $400.00 of groceries, on the day it was spent.
    expect(screen.getByRole("button", { name: "Groceries 2026-07-12" }).textContent).toBe("40000");
    expect(screen.getByTestId("chart-focus").textContent).toContain("Jul 2026, by day");
    await user.click(screen.getByRole("button", { name: /Back to the whole period/ }));
    expect(barKeys("Groceries")).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  test("a month the period cuts short drills to its own days only", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={customPeriod("2026-07-15", "2026-08-15")} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    await user.click(screen.getByRole("button", { name: "Month" }));
    await user.click(screen.getByRole("button", { name: "Rent 2026-08" }));
    const days = barKeys("Rent");
    expect([days[0], days[days.length - 1], days.length]).toEqual(["2026-08-01", "2026-08-15", 15]);
  });

  test("clicking a week bar redraws that week by day", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    await user.click(screen.getByRole("button", { name: "Groceries 2026-08-09" }));
    expect(barKeys("Groceries")).toEqual(["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"]);
  });

  test("clicking a day lists its transactions: a ledger of that day that adds up to the day's bar", async () => {
    render(<ReportsSection dataLayer={layer()} period={august} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    fireEvent.click(screen.getByRole("button", { name: "Groceries 2026-08-12" }));
    const { parsed, total } = landed(window.location.hash);
    expect(parsed.initialFilter).toMatchObject({ kind: "expense", from: "2026-08-12", to: "2026-08-12" });
    expect(parsed.initialFilter.categories).toBeUndefined();
    expect(total.expenseCents).toBe(50000);
    expect(parsed.ledger?.back).toBe("#/reports?tab=spending&from=2026-08-01&to=2026-08-31");
  });
});

describe("a day's ledger under a category choice", () => {
  test("it lists the chosen lines only, and adds up to the day's bar", async () => {
    // Aug 12: $500.00 of groceries; Aug 13: $25.00 back. Only Groceries is chosen.
    render(<ReportsSection dataLayer={layer()} period={august} compare="none" categories={["Groceries"]} />);
    await screen.findByTestId("summary-total");
    fireEvent.click(screen.getByRole("button", { name: "Groceries 2026-08-12" }));
    const { parsed, total } = landed(window.location.hash);
    expect(parsed.initialFilter).toMatchObject({ categories: ["Groceries"], kind: "expense", from: "2026-08-12", to: "2026-08-12" });
    expect(total.expenseCents).toBe(50000);
    expect(parsed.ledger?.back).toContain("cat=Groceries");
  });
});

describe("stacked or regular columns", () => {
  // Regular is always side by side, with
  // every category too; it never collapses into one total column (was: 6 or more chosen).
  test("stacked by default; regular with every category draws the same columns side by side", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={august} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(screen.getByRole("button", { name: "Stacked" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button", { name: /^Rent 2026-08-/ }).every((b) => b.getAttribute("data-stack") === "c")).toBe(true);
    expect(screen.getAllByRole("button", { name: /^Refunds and credits 2026-08-/ }).length).toBe(31);

    await user.click(screen.getByRole("button", { name: "Regular" }));
    const rent = screen.getAllByRole("button", { name: /^Rent 2026-08-/ });
    expect(rent).toHaveLength(31);
    expect(rent.every((b) => b.getAttribute("data-stack") === "")).toBe(true);
    expect(screen.queryAllByRole("button", { name: /^Total 2026-08-/ })).toHaveLength(0);
    // Aug 13: $25.00 came back and nothing was spent: it hangs on the refunds column.
    expect(screen.getByRole("button", { name: "Refunds and credits 2026-08-13" }).textContent).toBe("-2500");
  });

  test("regular with 5 or fewer categories chosen puts them side by side", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={august} compare="none" categories={["Rent", "Groceries"]} />);
    await screen.findByTestId("summary-total");
    await user.click(screen.getByRole("button", { name: "Regular" }));
    for (const name of ["Rent", "Groceries", "Refunds and credits"]) {
      const bars = screen.getAllByRole("button", { name: new RegExp(`^${name} 2026-08-`) });
      expect(bars.every((b) => b.getAttribute("data-stack") === ""), name).toBe(true);
    }
    expect(screen.queryAllByRole("button", { name: /^Total 2026-08-/ })).toHaveLength(0);
  });
});

describe("narrowing to chosen budget lines", () => {
  test("the ranked list, the totals, the chart and the table follow the choice", async () => {
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={["Groceries", "Shopping"]} />);
    await screen.findByTestId("summary-total");
    expect(rankNames()).toEqual(["Groceries", "Shopping", "Refunds and credits"]);
    // 1,200.00 + 100.00 - 175.00 = 1,125.00
    expect(text("summary-total")).toBe(formatCents(112500));
    expect(text("rank-grand-total")).toBe(formatCents(112500));
    expect(text("report-grand-total")).toBe(formatCents(112500));
    expect(screen.queryAllByRole("button", { name: /^Rent / })).toHaveLength(0);
    expect(screen.queryByTestId("report-total-Rent")).toBeNull();
    // A total of the chosen lines opens a ledger of the chosen lines.
    const grand = landed(screen.getByTestId("rank-grand-total").querySelector("a")!.getAttribute("href")!);
    expect(grand.parsed.initialFilter.categories).toEqual(["Groceries", "Shopping"]);
    expect(formatCents(grand.total.expenseCents)).toBe(formatCents(112500));
    expect(grand.parsed.ledger?.back).toContain("cat=Groceries&cat=Shopping");
  });

  test("picked in the box and cleared with All categories, through the link", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "#/reports?tab=spending&period=last-3&cat=Groceries");
    configurePeriodStore({ asOf: () => "2026-08-31" });
    render(<ReportsSection dataLayer={layer()} compare="none" />);
    await screen.findByTestId("summary-total");
    expect(rankNames()).toEqual(["Groceries", "Refunds and credits"]);

    await user.type(screen.getByRole("combobox", { name: "Categories to show" }), "Din");
    await user.click(await screen.findByRole("option", { name: "Dining" }));
    await waitFor(() => expect(rankNames()).toEqual(["Groceries", "Dining", "Refunds and credits"]));
    expect(new URLSearchParams(window.location.hash.split("?")[1]).getAll("cat")).toEqual(["Groceries", "Dining"]);

    await user.click(screen.getByRole("button", { name: "All categories" }));
    await waitFor(() => expect(rankNames()).toEqual(["Rent", "Groceries", "Dining", "Shopping", "Refunds and credits"]));
    expect(window.location.hash).not.toContain("cat=");
  });

  test("opened as every category, it stays every category through a tab change and a ledger's Back", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("financial-future.report-categories", JSON.stringify(["Groceries"]));
    window.history.replaceState(null, "", "#/reports?tab=spending&from=2026-08-01&to=2026-08-31&compare=avg-3&allcat=1");
    configurePeriodStore({ asOf: () => "2026-08-31" });
    render(<ReportsSection dataLayer={layer()} compare="none" />);
    await screen.findByTestId("summary-total");
    const every = rankNames();
    expect(every).toContain("Rent"); // not just the remembered Groceries

    await user.click(screen.getByRole("tab", { name: "Income" }));
    await user.click(screen.getByRole("tab", { name: "Spending" }));
    fireEvent.click(screen.getByRole("button", { name: "Groceries 2026-08-12" }));
    const back = landed(window.location.hash).parsed.ledger!.back!;
    cleanup();
    window.history.replaceState(null, "", back);
    render(<ReportsSection dataLayer={layer()} compare="none" />);
    await screen.findByTestId("summary-total");
    expect(rankNames()).toEqual(every);
  });

  test("the box is on Spending only", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={["Groceries"]} />);
    await screen.findByTestId("summary-total");
    await user.click(screen.getByRole("tab", { name: /^Income$/ }));
    await screen.findByTestId("rank-total-Paychecks");
    expect(screen.queryByRole("combobox", { name: "Categories to show" })).toBeNull();
  });
});

describe("a comparison splits the same way", () => {
  test("the baseline per category is its purchases; refunds and the net total have their own", async () => {
    render(<ReportsSection dataLayer={layer()} period={august} compare="previous" categories={[]} />);
    await screen.findByTestId("summary-total");
    // July: Rent 1,500.00, Groceries 400.00, Shopping 100.00, nothing came back.
    expect(text("baseline-Groceries")).toBe(formatCents(40000));
    // Dining is new in August; Shopping had only money back in August, so it has no purchases row.
    expect(text("baseline-Dining")).toBe(formatCents(0));
    expect(screen.queryByTestId("rank-total-Shopping")).toBeNull();
    expect(text("baseline-Refunds and credits")).toBe(formatCents(0));
    expect(text("baseline-total")).toBe(formatCents(200000));
    // August total against the July baseline total.
    expect(text("change-total")).toBe("-$51.55");
  });
});
