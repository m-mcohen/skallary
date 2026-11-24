// @vitest-environment jsdom
// tests/ui/ReportsFollowups.test.tsx
//
// Reports follow-ups:
//   Reports' monthly averages divide by complete months only;
//     the unfinished month stays in the totals but not the average.
//   Regular always draws the categories side by side.
//   A click on a month (or week) bar narrows the whole page to it
//     until "Back to the whole period"; the choice rides in the link.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportsSection from "../../src/ui/ReportsSection";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import { customPeriod } from "../../src/domain/period";
import { formatCents } from "../../src/domain/money";
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

// June to October 2, 2026 (today).
const txns: NormalizedTxn[] = [
  t("rent-jun", "2026-06-05", -150000, "Rent"),
  t("rent-jul", "2026-07-05", -150000, "Rent"),
  t("rent-aug", "2026-08-05", -150000, "Rent"),
  t("rent-sep", "2026-09-05", -150000, "Rent"),
  t("rent-oct", "2026-10-01", -150000, "Rent"),
  t("groc-jun", "2026-06-12", -30000, "Groceries"),
  t("groc-jul", "2026-07-12", -40000, "Groceries"),
  t("groc-aug", "2026-08-12", -50000, "Groceries"),
  t("groc-back", "2026-08-13", 2500, "Groceries"),
  t("groc-sep", "2026-09-12", -45000, "Groceries"),
  t("groc-oct", "2026-10-02", -10000, "Groceries"),
  t("shop-jul", "2026-07-20", -10000, "Shopping"),
  t("shop-back", "2026-08-20", 15000, "Shopping"),
  t("dining-aug", "2026-08-21", -12345, "Dining"),
  t("dining-sep", "2026-09-21", -1, "Dining"),
  t("gas-aug", "2026-08-22", -6000, "Gas"),
  t("phone-aug", "2026-08-23", -8000, "Phone"),
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
const lateSummer = customPeriod("2026-08-01", "2026-10-02"); // October not over
const text = (id: string) => screen.getByTestId(id).textContent;
const rankNames = () => [...document.querySelectorAll("[data-rank-row]")].map((r) => r.getAttribute("data-rank-row"));
const hashQuery = () => new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf("?") + 1));
const ledgerOf = (testId: string) => {
  const href = screen.getByTestId(testId).querySelector("a")!.getAttribute("href")!;
  return parseLedgerQuery(new URLSearchParams(href.slice(href.indexOf("?") + 1)));
};

describe("monthly averages over complete months only", () => {
  // Aug 1 to Oct 2, today Oct 2. Spending (net of refunds) by month:
  //   Aug  1,500.00 + 500.00 - 25.00 - 150.00 + 123.45 + 60.00 + 80.00 = 2,088.45
  //   Sep  1,500.00 + 450.00 + 0.01 = 1,950.01
  //   Oct  1,500.00 + 100.00 = 1,600.00 (not over: in the total, not the average)
  // Total 5,638.46. Average (2,088.45 + 1,950.01) / 2 = 2,019.23.
  // The old rule (months covered, October counting 2/31) would read 5,638.46 / 2.0645 = 2,731.15.
  test("the totals block: the total keeps October, the average leaves it out and says which months", async () => {
    render(<ReportsSection dataLayer={layer()} period={lateSummer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(text("summary-total")).toBe(formatCents(563846));
    expect(text("summary-average")).toBe(formatCents(201923));
    expect(text("summary-average-note")).toMatch(/2 complete months, Aug 2026 to Sep 2026/);
    expect(text("summary-average-note")).toMatch(/not over yet, is in the total but not the average/);
    expect(text("rank-grand-avg")).toBe(formatCents(201923));
  });

  test("the ranked list: each line's average over the same complete months", async () => {
    render(<ReportsSection dataLayer={layer()} period={lateSummer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    // Rent (1,500.00 + 1,500.00) / 2 = 1,500.00; its total 4,500.00 keeps October.
    expect(text("rank-total-Rent")).toBe(formatCents(450000));
    expect(text("rank-avg-Rent")).toBe(formatCents(150000));
    // Groceries purchases (500.00 + 450.00) / 2 = 475.00 (October's 100.00 left out).
    expect(text("rank-avg-Groceries")).toBe(formatCents(47500));
    // Dining (123.45 + 0.01) / 2 = 61.73
    expect(text("rank-avg-Dining")).toBe(formatCents(6173));
    // Refunds (-175.00 + 0) / 2 = -87.50
    expect(text("rank-avg-Refunds and credits")).toBe(formatCents(-8750));
  });

  test("no complete month yet: no average, said in words, and the average cells stay empty", async () => {
    render(<ReportsSection dataLayer={layer()} period={customPeriod("2026-10-01", "2026-10-02")} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(screen.queryByTestId("summary-average")).toBeNull();
    expect(text("summary-average-note")).toMatch(/No complete month in this period yet/);
    expect(text("rank-avg-Rent")).toBe("");
    expect(text("rank-grand-avg")).toBe("");
  });
});

describe("Regular always draws the categories side by side", () => {
  test("six chosen categories stand side by side; none of them collapses into one Total column", async () => {
    const user = userEvent.setup();
    const six = ["Rent", "Groceries", "Dining", "Shopping", "Gas", "Phone"];
    render(<ReportsSection dataLayer={layer()} period={customPeriod("2026-08-01", "2026-08-31")} compare="none" categories={six} />);
    await screen.findByTestId("summary-total");
    await user.click(screen.getByRole("button", { name: "Regular" }));
    // Shopping only had money come back in August, so it has no purchases column.
    for (const name of ["Rent", "Groceries", "Dining", "Gas", "Phone", "Refunds and credits"]) {
      const bars = screen.getAllByRole("button", { name: new RegExp(`^${name} 2026-08-`) });
      expect(bars.every((b) => b.getAttribute("data-stack") === ""), name).toBe(true);
    }
    expect(screen.queryAllByRole("button", { name: /^Total 2026-08-/ })).toHaveLength(0);
    // Aug 12: Groceries $500.00 on its own column.
    expect(screen.getByRole("button", { name: "Groceries 2026-08-12" }).textContent).toBe("50000");
  });

  test("with every category, Regular draws them side by side too", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={customPeriod("2026-08-01", "2026-08-31")} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    await user.click(screen.getByRole("button", { name: "Regular" }));
    expect(screen.getAllByRole("button", { name: /^Rent 2026-08-/ }).every((b) => b.getAttribute("data-stack") === "")).toBe(true);
    expect(screen.queryAllByRole("button", { name: /^Total 2026-08-/ })).toHaveLength(0);
  });
});

describe("a click on a month or week narrows the whole page", () => {
  test("July clicked: the total, the ranked list and the monthly table follow July, and the link says so", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    await user.click(screen.getByRole("button", { name: "Month" }));
    await user.click(screen.getByRole("button", { name: "Groceries 2026-07" }));
    // July: Rent 1,500.00 + Groceries 400.00 + Shopping 100.00 = 2,000.00
    expect(text("summary-total")).toBe(formatCents(200000));
    expect(rankNames()).toEqual(["Rent", "Groceries", "Shopping"]);
    expect(text("rank-grand-total")).toBe(formatCents(200000));
    // A whole, ended month: the average is the month itself.
    expect(text("summary-average")).toBe(formatCents(200000));
    expect(screen.getByTestId("month-total-2026-07")).toBeTruthy();
    expect(screen.queryByTestId("month-total-2026-06")).toBeNull();
    expect(screen.queryByTestId("month-total-2026-08")).toBeNull();
    expect(text("summary-scope")).toMatch(/Jul 1 to Jul 31, 2026|Jul 2026/);
    expect(hashQuery().get("drill")).toBe("2026-07");
    // Every figure opens a ledger of July only, whose Back returns to July.
    const ledger = ledgerOf("rank-total-Groceries");
    expect(ledger.initialFilter).toMatchObject({ from: "2026-07-01", to: "2026-07-31", categories: ["Groceries"] });
    expect(new URLSearchParams(ledger.ledger!.back.slice(ledger.ledger!.back.indexOf("?") + 1)).get("drill")).toBe("2026-07");

    await user.click(screen.getByRole("button", { name: /Back to the whole period/ }));
    // Jun to Aug: 5,748.45 + 60.00 + 80.00 = 5,888.45
    expect(text("summary-total")).toBe(formatCents(588845));
    expect(screen.getByTestId("month-total-2026-06")).toBeTruthy();
    expect(hashQuery().get("drill")).toBeNull();
  });

  test("a week clicked narrows the page to that week; the link names its first and last day", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    await user.click(screen.getByRole("button", { name: "Groceries 2026-08-09" }));
    // Aug 9 to 15: Groceries 500.00 on Aug 12, 25.00 back on Aug 13 = 475.00
    expect(text("summary-total")).toBe(formatCents(47500));
    expect(hashQuery().get("drill")).toBe("2026-08-09_2026-08-15");
    // A week holds no complete month: no average.
    expect(screen.queryByTestId("summary-average")).toBeNull();
  });

  test("in the weekly view a tooltip names the whole week, not only its first day", async () => {
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(charts.last("Spending by week").formatTooltipX!("2026-08-09")).toBe("Aug 9 to Aug 15, 2026");
  });

  test("a click on a day, while narrowed, still lists that day's transactions", async () => {
    const user = userEvent.setup();
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    await user.click(screen.getByRole("button", { name: "Month" }));
    await user.click(screen.getByRole("button", { name: "Groceries 2026-07" }));
    fireEvent.click(screen.getByRole("button", { name: "Groceries 2026-07-12" }));
    const parsed = parseLedgerQuery(hashQuery());
    expect(parsed.initialFilter).toMatchObject({ kind: "expense", from: "2026-07-12", to: "2026-07-12" });
  });

  test("opened from a link that carries the month, the page opens narrowed to it", async () => {
    window.location.hash = "#/reports?tab=spending&from=2026-06-01&to=2026-08-31&drill=2026-07";
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(text("summary-total")).toBe(formatCents(200000));
    expect(screen.getByTestId("chart-focus").textContent).toContain("Jul 2026, by day");
  });

  test("a month outside the period in the link is ignored", async () => {
    window.location.hash = "#/reports?tab=spending&from=2026-06-01&to=2026-08-31&drill=2026-09";
    render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(text("summary-total")).toBe(formatCents(588845));
    expect(screen.queryByTestId("chart-focus")).toBeNull();
  });

  test("a new period starts on the whole period again", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReportsSection dataLayer={layer()} period={summer} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    await user.click(screen.getByRole("button", { name: "Month" }));
    await user.click(screen.getByRole("button", { name: "Groceries 2026-07" }));
    expect(hashQuery().get("drill")).toBe("2026-07");
    rerender(<ReportsSection dataLayer={layer()} period={customPeriod("2026-06-01", "2026-09-30")} compare="none" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(screen.queryByTestId("chart-focus")).toBeNull();
    expect(hashQuery().get("drill")).toBeNull();
  });

  test("a comparison stays with the whole period: hidden while narrowed, and said so", async () => {
    const user = userEvent.setup();
    // History back to February, so the period before June to August has something to compare with.
    render(<ReportsSection dataLayer={layer([t("rent-feb", "2026-02-05", -150000, "Rent"), ...txns])} period={summer} compare="previous" categories={[]} />);
    await screen.findByTestId("summary-total");
    expect(screen.getByTestId("baseline-total")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Month" }));
    await user.click(screen.getByRole("button", { name: "Groceries 2026-07" }));
    expect(screen.queryByTestId("baseline-total")).toBeNull();
    expect(text("drill-compare-note")).toMatch(/comparison is for the whole period/i);
  });
});
