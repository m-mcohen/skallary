// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import Charts, { type ChartsDataLayer } from "../../src/ui/Charts";
import type { Plan, BudgetLine } from "../../src/domain/plan-types";
import type { NormalizedTxn, Account } from "../../src/domain/types";
import type { TransactionAdjustment } from "../../src/domain/adjustments";
import type { Db } from "../../src/ui/lib/db";
import { mockChartBase } from "./charts/mock-chart-base";

vi.mock("../../src/ui/charts/ChartBase", async () => (await import("./charts/mock-chart-base")).default);
const charts = mockChartBase();
beforeEach(() => charts.reset());

const PLAN: Plan = {
  id: "2027",
  name: "2027 Plan",
  startDate: "2027-01-01",
  endDate: "2027-02-28",
  createdAt: "2027-01-01T00:00:00.000Z",
};

const ACCOUNTS: Account[] = [
  { id: "acct-a", name: "Main Checking", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
];

// January: $800 spent (Dining Out, an expense) and $3,000 received (Paychecks, income).
const TXNS: NormalizedTxn[] = [
  {
    sourceTransactionId: "t1",
    accountId: "acct-a",
    date: "2027-01-15",
    amountCents: -80000,
    sourceCategory: "Dining Out",
    merchant: "Cafe",
    isTransfer: false,
    sourceUpdatedAt: null,
  },
  {
    sourceTransactionId: "t2",
    accountId: "acct-a",
    date: "2027-01-01",
    amountCents: 300000,
    sourceCategory: "Paychecks",
    merchant: "Employer",
    isTransfer: false,
    sourceUpdatedAt: null,
  },
];

const BUDGET_LINES: BudgetLine[] = [
  { planId: "2027", planningCategory: "Dining Out", period: null, amountCents: 70000 },
  { planId: "2027", planningCategory: "Paychecks", period: null, amountCents: 300000 },
];

function makeStubDataLayer(): Partial<ChartsDataLayer> {
  return {
    loadDb: async () => ({}) as Db,
    getTransactions: async () => TXNS,
    getAccounts: async () => ACCOUNTS,
    getCategoryMappings: async () => ({}),
    getPlan: async () => PLAN,
    getBudgetLines: async () => BUDGET_LINES,
    getBudgetExtras: async () => ({ changes: [], bigMonths: [], notes: [] }),
    getTransactionAdjustments: async () => [] as TransactionAdjustment[],
  };
}

test("renders its two charts from the forecast", async () => {
  const dataLayer = makeStubDataLayer();
  const { findAllByText } = render(
    <Charts dataLayer={dataLayer} planId="2027" asOfDate="2027-01-31" />
  );

  await findAllByText("Monthly cash flow");

  // The cash-flow chart is given January's forecast income and expense, and the running total is a chart too.
  const flow = charts.last("Monthly cash flow");
  const january = (id: string) => flow.series.find((s) => s.id === id)!.points.find((p) => p.x === "2027-01")?.cents;
  expect(january("income")).toBe(300000);
  expect(january("expense")).toBe(80000);
  expect(charts.last("Running total, left over").series).toHaveLength(1);
});

test("renders a not-connected state when loadDb rejects (headless, no local server)", async () => {
  const dataLayer: Partial<ChartsDataLayer> = {
    loadDb: async () => {
      throw new Error("no local server");
    },
  };
  const { findByText } = render(<Charts dataLayer={dataLayer} />);
  await findByText("Not connected");
});

test("renders a no-data state when the plan does not exist", async () => {
  const dataLayer: Partial<ChartsDataLayer> = {
    ...makeStubDataLayer(),
    getPlan: async () => null,
  };
  const { findByText } = render(<Charts dataLayer={dataLayer} planId="missing" />);
  await findByText("No data yet");
});

// Same fixture/pattern as BudgetGrid.test.tsx's "Neutralize app-owned
// data-quality adjustments" test: a recurring $1,300 internal transfer
// miscoded under the "Paychecks" category. Charts is the last deferred
// rollup site (BudgetGrid and the seed service already apply adjustments) --
// this proves it now fetches getTransactionAdjustments and folds them in via
// applyAdjustments before rollupMonthly, so the transfer no longer inflates
// the charted income the way it would if adjustments were never applied.
test("applies transaction adjustments before charting (a $1,300 miscoded transfer is excluded from income)", async () => {
  const MISLABELED_TRANSFER: NormalizedTxn = {
    sourceTransactionId: "t3",
    accountId: "acct-a",
    date: "2027-01-20",
    amountCents: 130000, // $1,300 deposit
    sourceCategory: "Paychecks",
    merchant: "Internal transfer",
    isTransfer: false,
    sourceUpdatedAt: null,
  };
  const adjustments: TransactionAdjustment[] = [
    { matchKind: "category_amount", matchCategory: "Paychecks", matchAmountCents: 130000, action: "transfer", note: "test" },
  ];
  const getTransactionAdjustments = vi.fn(async () => adjustments);
  const dataLayer: Partial<ChartsDataLayer> = {
    ...makeStubDataLayer(),
    getTransactions: async () => [...TXNS, MISLABELED_TRANSFER],
    getTransactionAdjustments,
  };

  const { findAllByText } = render(
    <Charts dataLayer={dataLayer} planId="2027" asOfDate="2027-01-31" />
  );

  await findAllByText("Monthly cash flow");
  await waitFor(() => expect(getTransactionAdjustments).toHaveBeenCalled());

  // Neutralized to a transfer -> dropped by rollupMonthly -> the chart is given January's income
  // without the transfer, as every other rollup site in the app charts it.
  await waitFor(() => {
    const income = charts.last("Monthly cash flow").series.find((s) => s.id === "income")!;
    expect(income.points.find((p) => p.x === "2027-01")?.cents).toBe(300000);
  });
});
