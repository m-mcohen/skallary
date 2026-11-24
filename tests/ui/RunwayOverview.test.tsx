// @vitest-environment jsdom
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { mockChartBase } from "./charts/mock-chart-base";
import RunwayOverview, { buildLiquidData, type RunwayDataLayer } from "../../src/ui/RunwayOverview";
import type { Plan, BudgetLine, WishlistItem, AccountBalance } from "../../src/domain/plan-types";
import type { Account } from "../../src/domain/types";
import type { Db } from "../../src/ui/lib/db";
import { computeRunway } from "../../src/domain/runway";
import { projectFutureNet, RUNWAY_HORIZON_MONTHS } from "../../src/domain/runway-projection";

vi.mock("../../src/ui/charts/ChartBase", async () => (await import("./charts/mock-chart-base")).default);
const charts = mockChartBase();
beforeEach(() => charts.reset());
afterEach(cleanup);

// PLAN's own horizon ends Sep 2026 -- deliberately short, so a finite runway
// found many months past that date proves the projection is NOT plan-bounded
// (it comes from projectFutureNet's 24-month horizon, not buildForecast's
// plan.months).
const PLAN: Plan = {
  id: "plan1",
  name: "2026 Plan",
  startDate: "2026-01-01",
  endDate: "2026-09-30",
  createdAt: "2026-01-01T00:00:00Z",
};

const ACCOUNTS: Account[] = [
  { id: "acct-a", name: "Main Checking", type: "checking", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
];

// $62,254 drawable -- same fixture as tests/domain/runway-projection.test.ts's
// "feeds computeRunway to a real cash-out" case, so the expected 9-month
// crossing here is cross-checked against that domain test.
const BALANCES: AccountBalance[] = [
  { accountId: "acct-a", balanceCents: 6225400, asOf: "2026-08-31T00:00:00Z" },
];

// $0 modeled income + a $7,600/mo expense default -- identical to the domain
// fixture, so runwayMonths should be exactly 9 and crossZeroPeriod exactly
// 2027-05 (asOf 2026-08 + 9 months).
const ZERO_INCOME_LINES: BudgetLine[] = [
  { planId: "plan1", planningCategory: "Living", period: null, amountCents: 760000 },
  { planId: "plan1", planningCategory: "Income", period: null, amountCents: 0 },
];

// Positive, comfortably-larger income than expense every month -> net stays
// positive for the whole 24-month horizon -> "no limit" branch.
const POSITIVE_LINES: BudgetLine[] = [
  { planId: "plan1", planningCategory: "Living", period: null, amountCents: 100000 },
  { planId: "plan1", planningCategory: "Income", period: null, amountCents: 500000 },
];

function makeStubDataLayer(lines: BudgetLine[]): Partial<RunwayDataLayer> {
  return {
    loadDb: async () => ({}) as Db,
    getAccounts: async () => ACCOUNTS,
    getAccountBalances: async () => BALANCES,
    getPlan: async () => PLAN,
    getBudgetLines: async () => lines,
    getBudgetExtras: async () => ({ changes: [], bigMonths: [], notes: [] }),
    listWishlistItems: async () => [] as WishlistItem[],
  };
}

// Polish pass ("runway chart renders sparse"): a reviewer saw
// only a tiny stub in the browser instead of a full descending curve. The
// domain math (projectFutureNet/computeRunway) and buildLiquidData's mapping
// were both verified correct by inspection -- this asserts that directly,
// independent of jsdom's lack of a real layout engine (which is why the
// render test below can't do pixel-level checks -- see its own comment).
// It receives the FULL RUNWAY_HORIZON_MONTHS-length series, not a truncated
// one, confirming the chart's `data` prop is fine; the sparse render the
// controller saw is the page-body horizontal-overflow bug (fixed in
// App.tsx/SidebarInset -- min-w-0), not a truncated series here.
test("buildLiquidData maps the full RUNWAY_HORIZON_MONTHS-length projection into the chart's data, not a truncated slice", () => {
  const futureNet = projectFutureNet(ZERO_INCOME_LINES, "2026-08-31", RUNWAY_HORIZON_MONTHS);
  const runway = computeRunway(6225400, futureNet);
  const data = buildLiquidData(runway);

  expect(data).toHaveLength(RUNWAY_HORIZON_MONTHS);
  expect(data[0].period).toBe("2026-09");
  expect(data[data.length - 1].period).toBe("2028-08");
  // Months read Sep 2026 on every chart, never Sep '26.
  expect(data[0].label).toBe("Sep 2026");
  expect(data[data.length - 1].label).toBe("Aug 2028");
  expect(data.every((p) => Number.isFinite(p.cents))).toBe(true);
  // Monotonically descending every month at the $7,600/mo burn -- a real
  // full-length downward slope, not a short/flat stub.
  for (let i = 1; i < data.length; i++) {
    expect(data[i].cents).toBeLessThan(data[i - 1].cents);
  }
});

test("$0-income budget projects a finite runway past the plan's own horizon, says no salary is set, and draws a downward-sloping chart", async () => {
  const dataLayer = makeStubDataLayer(ZERO_INCOME_LINES);
  const { findByText } = render(
    <RunwayOverview dataLayer={dataLayer} planId="plan1" asOfDate="2026-08-31" />
  );

  // Finite runway, not "Cash-flow positive" / "no limit" -- matches the
  // domain fixture's 9-month crossing (2026-08 + 9 = 2027-05), which falls
  // 8 months after PLAN's own Sep-2026 end date.
  await findByText("9 months");
  await findByText(/Crosses zero in May 2027/);
  // Income comes from Settings, Salary, so with none set the screen says where to put it.
  await findByText(/No current salary is set/);

  // The chart is given one series that falls every month, and a zero line.
  const chart = charts.last("Drawable over time");
  const values = chart.series[0].points.map((p) => p.cents as number);
  expect(values.length).toBe(RUNWAY_HORIZON_MONTHS);
  expect(values.every((v, i) => i === 0 || v < values[i - 1])).toBe(true);
  expect(chart.marks).toEqual([{ kind: "hline", cents: 0, role: "bad", dash: true }]);
  // A 24-month line can be zoomed.
  expect(chart.zoom).toBe(true);

  // Avg. monthly net reflects the real projected burn ($7,600/mo, every
  // month, all 24 months) -- not $0/empty from a plan-bounded forecast --
  // which is a downward slope every month, spanning well past 4 months (the
  // 9-month crossing above already proves the span; this proves the slope).
  await findByText("-$7,600.00");
});

test("the screen says Drawable and Average monthly change", async () => {
  const dataLayer = makeStubDataLayer(ZERO_INCOME_LINES);
  const { findAllByText, findByText, queryByText } = render(
    <RunwayOverview dataLayer={dataLayer} planId="plan1" asOfDate="2026-08-31" />
  );
  expect((await findAllByText("Drawable")).length).toBeGreaterThan(0);
  await findByText("Average monthly change");
  expect(queryByText(/Drawable liquid/)).toBeNull();
  expect(document.body.textContent).not.toMatch(/drawable liquid/i);
  // The chart is named for the figure it draws.
  await findByText("Drawable over time");
  expect(document.body.textContent).not.toMatch(/liquid cash/i);
  expect(queryByText("Avg. monthly net")).toBeNull();
});

// The screen is Forecast now. Runway stays as the name of the
// figure on it (months the money lasts), not of the screen.
test("the screen is headed Forecast, and Runway names only the months figure", async () => {
  const dataLayer = makeStubDataLayer(ZERO_INCOME_LINES);
  const { findByRole, getByText } = render(
    <RunwayOverview dataLayer={dataLayer} planId="plan1" asOfDate="2026-08-31" />
  );
  expect((await findByRole("heading", { level: 2 })).textContent).toBe("Forecast");
  expect(getByText("Runway")).toBeTruthy();
});

test("positive cash-flow budget reports no runway limit within the projection horizon", async () => {
  const dataLayer = makeStubDataLayer(POSITIVE_LINES);
  const { findByText, queryByText } = render(
    <RunwayOverview dataLayer={dataLayer} planId="plan1" asOfDate="2026-08-31" />
  );

  await findByText("Cash-flow positive");
  await findByText(/No runway limit found within the 24-month projection horizon/);
  expect(queryByText(/modeled income/)).toBeNull();
});

test("renders a neutral empty state headlessly when the db is unreachable (no local server)", async () => {
  const dataLayer: Partial<RunwayDataLayer> = {
    loadDb: async () => {
      throw new Error("no local server");
    },
  };
  const { findByText } = render(<RunwayOverview dataLayer={dataLayer} planId={null} />);
  await findByText("Not connected");
});

// ---------------------------------------------------------------------------
// Real income against real costs, and the safety figure.
// ---------------------------------------------------------------------------

const LIVING_ONLY: BudgetLine[] = [{ planId: "plan1", planningCategory: "Living", period: null, amountCents: 760000 }];
// $8,000 a month lands in the bank from Sep 2026 (a typed take-home, no tax math).
const TYPED_8K = { premiumMonthlyCents: 63_000, maaserRate: 0.1, children: 1, currentSalary: { kind: "take-home" as const, monthlyCents: 800_000, fromPeriod: "2026-09" } };

test("the forecast runs the real income against the budget's costs, and keeps a small if-no-money-came-in line", async () => {
  const { findByText, findByTestId } = render(
    <RunwayOverview dataLayer={makeStubDataLayer(LIVING_ONLY)} planId="plan1" asOfDate="2026-08-31" salaryAssumptions={TYPED_8K} />
  );
  // 8,000 in, 7,600 out: +400 every month.
  await findByText("Cash-flow positive");
  await findByText("$400.00");
  // With nothing coming in: 62,254 / 7,600 crosses zero in the ninth month (from the $0-income case above).
  expect((await findByTestId("forecast-safety")).textContent).toBe("If no money came in, it would last 9 months.");
  expect((await findByTestId("forecast-income")).textContent).toMatch(/\$8,000\.00 a month/);
});

test("the safety line says more than 24 months when the money outlasts the projection", async () => {
  const { findByTestId } = render(<RunwayOverview dataLayer={makeStubDataLayer(POSITIVE_LINES)} planId="plan1" asOfDate="2026-08-31" />);
  // No income at all: 62,254 / 1,000 a month lasts 62 months, past the 24 shown.
  expect((await findByTestId("forecast-safety")).textContent).toBe("If no money came in, it would last more than 24 months.");
});

test("under a what-if, its costs count from next month when it has no salary, against the real income", async () => {
  const scenario = { id: "w", planId: "plan1", name: "Rent", isDefault: false, income: { kind: "plan" as const }, expenseDeltas: [], createdAt: "" };
  const whatIf = {
    scenarioId: "w", salaryGrossAnnualCents: null, salaryFromPeriod: null, rows: [],
    changes: [{ id: "c", position: 1, kind: "add" as const, label: "Rent", planningCategory: "Rent", amountCents: 100_000, fromPeriod: "2027-06", untilPeriod: null, loan: null }],
  };
  const { findByText, findByTestId } = render(
    <RunwayOverview dataLayer={makeStubDataLayer(LIVING_ONLY)} planId="plan1" asOfDate="2026-08-31" salaryAssumptions={TYPED_8K} scenario={scenario} whatIf={whatIf} />
  );
  // 8,000 in, 7,600 + 1,000 out from Sep 2026 (the stored Jun 2027 is not read): -600 a month.
  await findByText("-$600.00");
  // No income: 8,600 a month. 62,254 - 7 x 8,600 = 2,054 left after month seven; month eight crosses.
  expect((await findByTestId("forecast-safety")).textContent).toBe("If no money came in, it would last 8 months.");
});

// Once next year's budget exists, the Forecast reads
// each future month from its own year's plan, so it reads every plan's lines.
test("with two plans the Forecast reads both budgets; with one it reads only its own", async () => {
  const getBudgetLines = vi.fn(async (_db: Db, planId: string) => POSITIVE_LINES.map((l) => ({ ...l, planId })));
  const two = { ...makeStubDataLayer(POSITIVE_LINES), getBudgetLines, listPlans: async () => [PLAN, { ...PLAN, id: "plan2", startDate: "2027-01-01", endDate: "2027-12-31" }] };
  const { findByText, unmount } = render(<RunwayOverview dataLayer={two} planId="plan1" asOfDate="2026-12-15" />);
  await findByText("Cash-flow positive");
  expect(getBudgetLines.mock.calls.map((c) => c[1]).sort()).toEqual(["plan1", "plan2"]);
  unmount();
  getBudgetLines.mockClear();
  const one = { ...makeStubDataLayer(POSITIVE_LINES), getBudgetLines, listPlans: async () => [PLAN] };
  const second = render(<RunwayOverview dataLayer={one} planId="plan1" asOfDate="2026-12-15" />);
  await second.findByText("Cash-flow positive");
  expect(getBudgetLines.mock.calls.map((c) => c[1])).toEqual(["plan1"]);
});
