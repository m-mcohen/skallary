// @vitest-environment jsdom
// The "Where pay goes" card on the Charts tab, and the wiring of zoom, click-through and linked hover.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import Charts, { type ChartsDataLayer } from "../../src/ui/Charts";
import type { Plan, BudgetLine } from "../../src/domain/plan-types";
import type { NormalizedTxn, Account } from "../../src/domain/types";
import type { TransactionAdjustment } from "../../src/domain/adjustments";
import { DEFAULT_SALARY_ASSUMPTIONS, type SalaryAssumptions } from "../../src/domain/salary";
import type { Db } from "../../src/ui/lib/db";
import { mockChartBase, type ChartCall } from "./charts/mock-chart-base";
import { flowLinks } from "./charts/option-reader";
import { PALETTE } from "./charts/sankey-fixtures";

vi.mock("../../src/ui/charts/ChartBase", async () => (await import("./charts/mock-chart-base")).default);
const charts = mockChartBase();
beforeEach(() => charts.reset());
afterEach(cleanup);

const PLAN: Plan = { id: "2027", name: "2027 Plan", startDate: "2027-01-01", endDate: "2027-12-31", createdAt: "2027-01-01T00:00:00.000Z" };
const ACCOUNTS: Account[] = [
  { id: "main", name: "Test Checking", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
];
const txn = (id: string, date: string, cents: number, category: string): NormalizedTxn => ({
  sourceTransactionId: id, accountId: "main", date, amountCents: cents, sourceCategory: category, merchant: null, isTransfer: false, sourceUpdatedAt: null,
});
// January and February: pay of 3000 each month, dining out of 800 in January and 400 in February.
const TXNS = [
  txn("a", "2027-01-01", 300000, "Paychecks"), txn("b", "2027-01-15", -80000, "Dining Out"),
  txn("c", "2027-02-01", 300000, "Paychecks"), txn("d", "2027-02-10", -40000, "Dining Out"),
];
const LINES: BudgetLine[] = [{ planId: "2027", planningCategory: "Dining Out", period: null, amountCents: 70000 }];
const WITH_SALARY: SalaryAssumptions = {
  ...DEFAULT_SALARY_ASSUMPTIONS,
  currentSalary: { kind: "gross", grossAnnualCents: 6000000, fromPeriod: "2027-01" },
};

function layer(salary: SalaryAssumptions): Partial<ChartsDataLayer> {
  return {
    loadDb: async () => ({}) as Db,
    getTransactions: async () => TXNS,
    getAccounts: async () => ACCOUNTS,
    getCategoryMappings: async () => ({}),
    getPlan: async () => PLAN,
    getBudgetLines: async () => LINES,
    getBudgetExtras: async () => ({ changes: [], bigMonths: [], notes: [] }),
    getTransactionAdjustments: async () => [] as TransactionAdjustment[],
    getSalarySettings: async () => salary,
    getMaaserMarks: async () => [],
  };
}

const sankey = (): ChartCall => charts.last("Where pay goes");
/** The option the Sankey card handed the chart base, built for the test palette. */
const optionOf = () => (sankey().option as (pal: typeof PALETTE, dark: boolean) => unknown)(PALETTE, false);
const bankIn = (cents: number) => ({ source: "in:Paychecks", target: "bank", cents, opacity: 0.55 });

async function open(salary: SalaryAssumptions) {
  const view = render(<Charts dataLayer={layer(salary)} planId="2027" asOfDate="2027-02-20" />);
  await screen.findByText("Where pay goes");
  return view;
}

test("the Where pay goes chart starts at the money that reached the bank and offers the paycheck only when Salary is filled in", async () => {
  await open(DEFAULT_SALARY_ASSUMPTIONS);
  expect(sankey().description).toMatch(/^\$3,000\.00 came into your bank/);
  const paycheck = screen.getByRole("button", { name: "Full paycheck" }) as HTMLButtonElement;
  expect(paycheck.disabled || paycheck.getAttribute("aria-disabled") === "true" || paycheck.hasAttribute("data-disabled")).toBe(true);
  expect(screen.getByText("Fill in Salary settings to add the full paycheck")).toBeTruthy();
  cleanup();

  charts.reset();
  await open(WITH_SALARY);
  expect(screen.queryByText("Fill in Salary settings to add the full paycheck")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Full paycheck" }));
  await waitFor(() => expect(sankey().description).toMatch(/^Your gross pay of /));
  expect(flowLinks(optionOf()).some((l) => l.source === "gross")).toBe(true);
});

test("switching month and year changes the period given", async () => {
  await open(DEFAULT_SALARY_ASSUMPTIONS);
  // Month: February alone, pay of 3000. Year: January through February, pay of 6000.
  expect(flowLinks(optionOf())).toContainEqual(bankIn(300000));
  fireEvent.click(screen.getByRole("button", { name: "Year" }));
  await waitFor(() => expect(flowLinks(optionOf())).toContainEqual(bankIn(600000)));
});

test("clicking a category band goes to that category's ledger, and a band with no rows does nothing", async () => {
  await open(DEFAULT_SALARY_ASSUMPTIONS);
  window.location.hash = "#/budget/charts";
  sankey().onNodeClick!("cat:Dining Out");
  expect(window.location.hash).toContain("#/transactions?ledger=1");
  expect(window.location.hash).toContain("cat=Dining+Out");
  expect(window.location.hash).toContain("from=2027-02-01");
  expect(window.location.hash).toContain("to=2027-02-28");

  window.location.hash = "#/budget/charts";
  sankey().onNodeClick!("left-over");
  expect(window.location.hash).toBe("#/budget/charts");
});

test("the Charts tab's two charts share a link group, and a month bar opens that month's ledger", async () => {
  await open(DEFAULT_SALARY_ASSUMPTIONS);
  const flow = charts.last("Monthly cash flow");
  const surplus = charts.last("Running total, left over");
  expect(flow.linkGroup).toBeTruthy();
  expect(flow.linkGroup).toBe(surplus.linkGroup);
  expect(flow.zoom).toBe(true);
  expect(surplus.zoom).toBe(true);
  expect(sankey().linkGroup).toBeUndefined();

  window.location.hash = "#/budget/charts";
  fireEvent.click(screen.getByRole("button", { name: "Expense 2027-02" }));
  expect(window.location.hash).toContain("kind=expense");
  expect(window.location.hash).toContain("from=2027-02-01");
});
