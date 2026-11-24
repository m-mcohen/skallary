// tests/domain/one-time-cost.test.ts
//
// A "One-time cost"
// row kind on a what-if's list: a label, an amount and the month it is paid. It is
// switched and moved like any row; the Forecast counts it once, in its month; it is
// kept out of Salary needed, Take-home needed, Monthly budget and the ladder's
// totals, like a down payment.
import { describe, expect, test } from "vitest";
import { cashForecast } from "../../src/domain/cash-forecast";
import {
  ONE_TIME_LINE,
  changeProblem,
  composeWhatIf,
  onChanges,
  oneTimeCosts,
  salaryVerdict,
  whatIfLadder,
  whatIfList,
  whatIfPeriods,
  type WhatIf,
  type WhatIfChange,
} from "../../src/domain/what-if";
import { summariseForMasthead } from "../../src/ui/lib/instrument";
import type { SalaryAssumptions } from "../../src/domain/salary";
import type { BudgetLine } from "../../src/domain/plan-types";
import type { Scenario } from "../../src/domain/scenario";

const A: SalaryAssumptions = { premiumMonthlyCents: 50_000, maaserRate: 0.1, children: 1 };
const LINES: BudgetLine[] = [
  { planId: "p", planningCategory: "Living", period: null, amountCents: 500_000 }, // $5,000.00
  { planId: "p", planningCategory: "Charity", period: null, amountCents: 30_000 }, // $300.00
];
const wedding: WhatIfChange = { id: "w", position: 1, kind: "one-time", label: "Wedding", planningCategory: ONE_TIME_LINE, amountCents: 1_500_000, fromPeriod: "2027-03", untilPeriod: "2027-03", loan: null };
const sofa: WhatIfChange = { ...wedding, id: "s", position: 2, label: "Sofa", amountCents: 250_000 };
const car: WhatIfChange = { id: "c", position: 3, kind: "add", label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2026-11", untilPeriod: null, loan: null };
const whatIf = (changes: WhatIfChange[], on: Record<string, boolean> = {}): WhatIf => ({
  scenarioId: "s1",
  salaryGrossAnnualCents: null,
  salaryFromPeriod: null,
  changes,
  rows: changes.map((c, i) => ({ kind: "change" as const, refId: c.id, position: i + 1, on: on[c.id] ?? true })),
});
const cost = (months: { period: string; costCents: number }[], period: string) => months.find((m) => m.period === period)!.costCents;

describe("saving one", () => {
  test("a label, an amount and the month it is paid", () => {
    expect(changeProblem(wedding)).toBeNull();
    expect(changeProblem({ ...wedding, fromPeriod: "" })).toBe("Pick the month it is paid.");
    expect(changeProblem({ ...wedding, label: " " })).toBe("Give the change a name.");
    expect(changeProblem({ ...wedding, amountCents: -1 })).toBe("A cost cannot be below zero.");
  });
});

describe("on the list", () => {
  test("listed and switchable like any row, with its amount", () => {
    const list = whatIfList(whatIf([car, wedding], { w: false }), []);
    expect(list.map((r) => [r.label, r.on, r.monthlyCents])).toEqual([
      ["New car", true, 70_000],
      ["Wedding", false, 1_500_000],
    ]);
  });

  test("never a monthly change: only switched-on one-time costs are one-time costs", () => {
    const w = whatIf([car, wedding, sofa], { s: false });
    expect(onChanges(w).map((c) => c.id)).toEqual(["c"]);
    expect(oneTimeCosts(w).map((c) => [c.label, c.amountCents, c.fromPeriod])).toEqual([["Wedding", 1_500_000, "2027-03"]]);
  });
});

describe("in the Forecast: once, in its month", () => {
  // Nov 2026 to Oct 2028. Every month costs Living 5,000.00 + Charity 300.00 + the car 700.00 = 6,000.00.
  test("the month it is paid carries it; no other month does", () => {
    const m = cashForecast({ budgetLines: LINES, asOfDate: "2026-10-15", assumptions: A, whatIf: whatIf([car, wedding]) });
    // March 2027: 6,000.00 + 15,000.00 = 21,000.00
    expect(cost(m, "2027-03")).toBe(2_100_000);
    expect(cost(m, "2027-02")).toBe(600_000);
    expect(cost(m, "2027-04")).toBe(600_000);
    // Counted once across the 24 months: 24 x 6,000.00 + 15,000.00 = 159,000.00
    expect(m.reduce((sum, x) => sum + x.costCents, 0)).toBe(15_900_000);
  });

  test("two in the same month both count; a switched-off one counts nowhere", () => {
    const both = cashForecast({ budgetLines: LINES, asOfDate: "2026-10-15", assumptions: A, whatIf: whatIf([wedding, sofa]) });
    // 5,300.00 + 15,000.00 + 2,500.00 = 22,800.00
    expect(cost(both, "2027-03")).toBe(2_280_000);
    const off = cashForecast({ budgetLines: LINES, asOfDate: "2026-10-15", assumptions: A, whatIf: whatIf([wedding, sofa], { w: false, s: false }) });
    expect(cost(off, "2027-03")).toBe(530_000);
  });

  test("the top bar's runway overlay has it once, on a line of its own, in its month", () => {
    const scenario: Scenario = { id: "s1", planId: "p", name: "Wedding year", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "2026-10-02" };
    const composed = composeWhatIf(scenario, whatIf([wedding]), LINES, whatIfPeriods("2026-10"), A, [], "2026-11");
    expect(composed.expenseDeltas.filter((d) => d.deltaCents !== 0)).toEqual([{ planningCategory: "One-time cost: Wedding", period: "2027-03", deltaCents: 1_500_000 }]);
  });
});

describe("kept out of the salary math, like a down payment", () => {
  test("the ladder: no step, and both totals as if it were not there", () => {
    const withIt = whatIfLadder(whatIf([car, wedding]), LINES, [], "2026-11", A);
    const without = whatIfLadder(whatIf([car]), LINES, [], "2026-11", A);
    expect(withIt.rungs.map((r) => r.id)).toEqual(["start", "c"]);
    expect(withIt.salaryToLiveCents).toBe(without.salaryToLiveCents);
    expect(withIt.salaryToLiveAndHitGoalsCents).toBe(without.salaryToLiveAndHitGoalsCents);
    expect(withIt.statements).toEqual(without.statements);
  });

  test("the verdict and Check a salary do not walk it", () => {
    const w = whatIf([car, wedding]);
    const ladder = whatIfLadder(w, LINES, [], "2026-11", A);
    const v = salaryVerdict(ladder, 9_000_000, A, { whatIf: w, baseLines: LINES });
    const vWithout = salaryVerdict(whatIfLadder(whatIf([car]), LINES, [], "2026-11", A), 9_000_000, A, { whatIf: whatIf([car]), baseLines: LINES });
    expect(v).toEqual(vWithout);
  });

  test("the top bar: Monthly budget, Salary needed and Take-home needed are as if it were not there", () => {
    const scenario: Scenario = { id: "s1", planId: "p", name: "Wedding year", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "2026-10-02" };
    const base = { accounts: [], balances: [], budgetLines: LINES, categorySettings: [], uncategorizedCount: 0, ruleCount: 0, lastSyncedAt: null, asOfDate: "2026-10-15", salaryAssumptions: A, scenario };
    const withIt = summariseForMasthead({ ...base, whatIf: whatIf([car, wedding]) });
    const without = summariseForMasthead({ ...base, whatIf: whatIf([car]) });
    // 5,000.00 + 300.00 + 700.00 = 6,000.00 either way
    expect(withIt.reading.burnCents).toBe(600_000);
    expect(withIt.reading.burnCents).toBe(without.reading.burnCents);
    expect(withIt.salary!.grossAnnualCents).toBe(without.salary!.grossAnnualCents);
    expect(withIt.salary!.statement).toEqual(without.salary!.statement);
  });
});
