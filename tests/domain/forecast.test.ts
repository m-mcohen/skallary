import { expect, test } from "vitest";
import { buildForecast } from "../../src/domain/forecast";
import type { Plan, BudgetLine } from "../../src/domain/plan-types";
import type { MonthlyRollup } from "../../src/domain/rollups";

const plan: Plan = { id: "2027", name: "2027", startDate: "2027-01-01", endDate: "2027-03-31", createdAt: "x" };
const lines: BudgetLine[] = [
  { planId: "2027", planningCategory: "Dining Out", period: null, amountCents: 70000 },
  { planId: "2027", planningCategory: "Paychecks", period: null, amountCents: 500000 },
];

test("elapsed month uses actuals; future uses plan; variance computed", () => {
  const actuals: MonthlyRollup[] = [
    { period: "2027-01", planningCategory: "Dining Out", kind: "expense", amountCents: 80000 },
    { period: "2027-01", planningCategory: "Paychecks", kind: "income", amountCents: 500000 },
  ];
  const f = buildForecast(plan, lines, actuals, "2027-01-31");
  const jan = f.months.find((m) => m.period === "2027-01")!;
  const janDining = jan.cells.find((c) => c.planningCategory === "Dining Out")!;
  expect(janDining).toMatchObject({ actualCents: 80000, planCents: 70000, forecastCents: 80000, varianceCents: 10000 });
  const feb = f.months.find((m) => m.period === "2027-02")!;
  const febDining = feb.cells.find((c) => c.planningCategory === "Dining Out")!;
  expect(febDining).toMatchObject({ actualCents: 0, planCents: 70000, forecastCents: 70000 }); // future → plan
});

test("totals: income/expense forecast, surplus, savings rate, cumulative", () => {
  const actuals: MonthlyRollup[] = [
    { period: "2027-01", planningCategory: "Dining Out", kind: "expense", amountCents: 80000 },
    { period: "2027-01", planningCategory: "Paychecks", kind: "income", amountCents: 500000 },
  ];
  const f = buildForecast(plan, lines, actuals, "2027-01-31");
  // income forecast = 500000 (Jan actual) + 500000 + 500000 (Feb,Mar plan) = 1,500,000
  // expense forecast = 80000 (Jan actual) + 70000 + 70000 (Feb,Mar plan) = 220,000
  expect(f.totals.incomeForecastCents).toBe(1500000);
  expect(f.totals.expenseForecastCents).toBe(220000);
  expect(f.totals.surplusForecastCents).toBe(1280000);
  expect(f.totals.savingsRate).toBeCloseTo(1280000 / 1500000, 6);
  expect(f.totals.cumulativeSurplus.map((c) => c.cents)).toEqual([420000, 850000, 1280000]);
  expect(f.asOfDate).toBe("2027-01-31");
});

test("savings rate is 0 when no income", () => {
  const f = buildForecast(plan, [lines[0]], [], "2027-01-31");
  expect(f.totals.savingsRate).toBe(0);
});

test("planned event adds a future-month expense; elapsed months unaffected", () => {
  const plan = { id: "p", name: "", startDate: "2027-01-01", endDate: "2027-03-31", createdAt: "" };
  const events = [{ period: "2027-03", planningCategory: "Travel", amountCents: 200000 }];
  const f = buildForecast(plan, [], [], "2027-01-31", events);
  const mar = f.months.find((m) => m.period === "2027-03")!;
  const travel = mar.cells.find((c) => c.planningCategory === "Travel")!;
  expect(travel.forecastCents).toBe(200000);
  expect(travel.kind).toBe("expense");
  expect(f.totals.expenseForecastCents).toBe(200000);
  expect(mar.netCents).toBe(-200000);
});

test("planned event in an ELAPSED month is ignored (actuals own it)", () => {
  const plan = { id: "p", name: "", startDate: "2027-01-01", endDate: "2027-03-31", createdAt: "" };
  const f = buildForecast(plan, [], [], "2027-03-31", [{ period: "2027-02", planningCategory: "Travel", amountCents: 200000 }]);
  expect(f.totals.expenseForecastCents).toBe(0);
});

test("planned event with income-keyword planningCategory is forced to expense (runway sign-flip fix)", () => {
  const plan = { id: "p", name: "", startDate: "2027-01-01", endDate: "2027-03-31", createdAt: "" };
  // Planned event with planningCategory "Bonus" (an income keyword) but it's a planned EXPENSE
  const events = [{ period: "2027-03", planningCategory: "Bonus", amountCents: 150000 }];
  const f = buildForecast(plan, [], [], "2027-01-31", events);
  const mar = f.months.find((m) => m.period === "2027-03")!;
  const bonus = mar.cells.find((c) => c.planningCategory === "Bonus")!;
  // Kind must be "expense" even though "Bonus" matches isIncomeCategory
  expect(bonus.kind).toBe("expense");
  // Cost must land in expenseForecastCents, not income
  expect(f.totals.expenseForecastCents).toBe(150000);
  expect(f.totals.incomeForecastCents).toBe(0);
  // Month's net must be negative by the cost (expense shrinks liquid)
  expect(mar.netCents).toBe(-150000);
});

// Saving and investment income are not
// budgeted. A budget line under one of those names must
// not come back into the forecast as a planned expense or income.
test("a budget line for Investing or Interest is left out of the forecast", () => {
  const withSaving: BudgetLine[] = [
    ...lines,
    { planId: "2027", planningCategory: "Investing", period: null, amountCents: 100000 },
    { planId: "2027", planningCategory: "Interest", period: null, amountCents: 5000 },
  ];
  const f = buildForecast(plan, withSaving, [], "2026-12-31");
  const cats = new Set(f.months.flatMap((m) => m.cells.map((c) => c.planningCategory)));
  expect(cats.has("Investing")).toBe(false);
  expect(cats.has("Interest")).toBe(false);
  expect(f.totals.expenseForecastCents).toBe(70000 * 3);
  expect(f.totals.incomeForecastCents).toBe(500000 * 3);
});

test("a big month adds to its line's plan in its month, finished or not", () => {
  const plan = { id: "p", name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", createdAt: "" };
  const lines = [{ planId: "p", planningCategory: "Gifts", period: null, amountCents: 10000 }];
  const big = [{ id: 1, planId: "p", planningCategory: "Gifts", month: "2026-03", label: "Birthday", amountCents: 50000, createdAt: "" }];
  const f = buildForecast(plan, lines, [], "2026-10-06", [], big);
  const cell = (m: string) => f.months.find((x) => x.period === m)!.cells.find((c) => c.planningCategory === "Gifts")!;
  expect(cell("2026-03").planCents).toBe(60000);
  expect(cell("2026-04").planCents).toBe(10000);
});
