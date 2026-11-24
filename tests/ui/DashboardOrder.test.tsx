// @vitest-environment jsdom
// tests/ui/DashboardOrder.test.tsx
// The Dashboard reads month bar, chart,
// spending and income side by side, Waiting on you (with its link), the tiles,
// Recurring, Goals, then the Fixed and Variable budget cards. A past month keeps
// the same order. Fixture copied from tests/ui/DashboardMonths.test.tsx.
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";

import DashboardSection from "../../src/ui/DashboardSection";
import type { HeadState } from "../../src/ui/lib/useMastheadSummary";
import type { MonthSource } from "../../src/domain/dashboard-month";
import type { BudgetLine } from "../../src/domain/plan-types";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import { spendingCurves } from "../../src/domain/spending-curve";

const TODAY = "2026-10-02";

const accounts: Account[] = [
  { id: "card", name: "Card", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
];
let n = 0;
const t = (date: string, amountCents: number, sourceCategory = "Groceries", over: Partial<NormalizedTxn> = {}): NormalizedTxn =>
  ({ sourceTransactionId: `t${n++}`, accountId: "card", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, payee: "Store", ...over }) as NormalizedTxn;

// By hand (the same months as tests/domain/dashboard-month.test.ts):
//   July:   $25.00 + $100.00 + $50.00 = $175.00 spent, no income
//   August: Rent $200.00; Groceries $30.00 + $70.00 + $15.00 = $315.00 spent
//           income $5,000.00 + $1,000.00 = $6,000.00; left over $5,685.00
//   October so far: $40.00 on the 1st
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
// August's budget by hand: Rent $200.00 + Groceries $150.00 (August's own amount) = $350.00.
const budgetLines = [line("Rent", 20000), line("Groceries", 10000), line("Groceries", 15000, "2026-08"), line("Paychecks", 500000)];

const monthSource: MonthSource = { prepared: txns, accounts, mapping: {}, budgetLines, today: TODAY, firstMonth: "2026-07" };

// Today's figures, as the top of the app reads them: Monthly budget is $7,000.00,
// not August's $350.00, so a tile that followed the month would show.
const summary = {
  reading: { drawableCents: 7500000, burnCents: 700000, runwayMonths: 10.7, crossPeriod: "2027-08", series: [] },
  baselineSeries: null,
  scenarioLabel: null,
  heldBackCents: 1800000,
  recurringCents: 600000,
  variableCents: 100000,
  accountCount: 7,
  uncategorizedCount: 0,
  ruleCount: 100,
  lastSyncedAt: "2026-10-02T08:00:00-04:00",
  trailingCents: 650000,
  lastSeedAt: "2026-09-02T14:07:00-04:00",
  reseedDue: false,
  // This month so far, as the Dashboard reads it today: Oct 1 to Oct 2.
  spentThisMonth: {
    period: { preset: "this-month", from: "2026-10-01", to: "2026-10-02" },
    cents: 4000,
    baseline: { range: { from: "2026-09-01", to: "2026-09-02" }, cents: 0, byCategory: { Groceries: 0 } },
    leftOverCents: -4000,
    savingCents: 0,
    topCategories: [{ category: "Groceries", cents: 4000 }],
  },
  incomeThisMonth: {
    period: { preset: "this-month", from: "2026-10-01", to: "2026-10-02" },
    cents: 0,
    baseline: { range: { from: "2026-09-01", to: "2026-09-02" }, cents: 0 },
    investmentIncomeCents: 0,
    topSources: [],
  },
  spendingCurves: null,
} as unknown as HeadState;

const withSource = (over: Partial<MonthSource> = {}) => ({ ...summary, monthSource: { ...monthSource, ...over } }) as HeadState;
const props = { planId: "p1", onChanged: () => {} };


const ORDER = ["month", "chart", "spending-income", "waiting", "tiles", "recurring", "goals", "budget"];
const order = (root: HTMLElement) => [...root.querySelectorAll("[data-dash-section]")].map((e) => e.getAttribute("data-dash-section"));
const withCurves = () => ({ ...withSource(), spendingCurves: spendingCurves(txns, accounts, {}, TODAY) }) as HeadState;

beforeEach(() => window.history.replaceState(null, "", "#/dashboard"));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

test("this month reads month, chart, spending and income, Waiting on you, tiles, Recurring, Goals, budget cards", () => {
  const { container } = render(<DashboardSection {...props} summary={withCurves()} />);
  expect(order(container)).toEqual(ORDER);
});

test("spending and income sit in one row that splits in two on a wide screen", () => {
  const { container } = render(<DashboardSection {...props} summary={withCurves()} />);
  const pair = container.querySelector('[data-dash-section="spending-income"]')!;
  expect(pair.className).toContain("lg:grid-cols-2");
  expect(pair.querySelector('[aria-label="This month so far"]')).not.toBeNull();
  expect(pair.querySelector('[data-testid="spend-chart-summary"]')).toBeNull();
});

test("Review all uncategorized transactions sits directly under Waiting on you", () => {
  const { container } = render(<DashboardSection {...props} summary={withCurves()} />);
  const waiting = container.querySelector('[data-dash-section="waiting"]')!;
  expect(waiting.querySelector('a[href="#/transactions/needs-category"]')).not.toBeNull();
  expect(container.querySelectorAll('a[href="#/transactions/needs-category"]')).toHaveLength(1);
});

test("a past month keeps the same order", () => {
  window.history.replaceState(null, "", "#/dashboard?month=2026-08");
  const { container } = render(<DashboardSection {...props} summary={withSource()} />);
  expect(order(container)).toEqual(ORDER);
});
