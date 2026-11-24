// tests/domain/what-if-goal-costs.test.ts -- a ticked goal's planned ongoing cost counts inside Salary
// to live, in that what-if's runway, and wherever the what-if is laid over.
import { describe, expect, test } from "vitest";
import { applyWhatIfs, checkSalary, composeWhatIf, plannedGoalCosts, whatIfLadder, type WhatIf } from "../../src/domain/what-if";
import { DEFAULT_SALARY_ASSUMPTIONS as a } from "../../src/domain/salary";
import type { BudgetLine, Goal } from "../../src/domain/plan-types";
import type { Scenario } from "../../src/domain/scenario";
import { isIncomeCategory } from "../../src/domain/dedup";

const base: BudgetLine[] = [{ planId: "p", planningCategory: "Rent", period: null, amountCents: 210000 }];
// A goal ticked the older way: its cost row, then its saving row, both on.
const w = (goalIds: string[]): WhatIf => ({
  scenarioId: "s", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [],
  rows: [
    ...goalIds.map((refId, i) => ({ kind: "goal-cost" as const, refId, position: i + 1, on: true })),
    ...goalIds.map((refId, i) => ({ kind: "goal-saving" as const, refId, position: goalIds.length + i + 1, on: true })),
  ],
});
const goal = (id: string, over: Partial<Goal> = {}): Goal => ({ id, name: id, goalType: "savings", targetAmountCents: 100000, targetDate: null, priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null, ...over });
const house = goal("House", { ongoingMonthlyCents: 400000 });

describe("plannedGoalCosts", () => {
  test("a ticked goal with a planned cost counts; started, archived, unticked, deleted or costless ones do not", () => {
    const goals = [house, goal("Started", { ongoingMonthlyCents: 5000, ongoingStartedPeriod: "2026-09" }), goal("Gone", { ongoingMonthlyCents: 5000, archivedAt: "x" }), goal("Free"), goal("Unticked", { ongoingMonthlyCents: 5000 })];
    expect(plannedGoalCosts(w(["House", "Started", "Gone", "Free", "missing"]), goals)).toEqual([{ goalId: "House", label: "House", monthlyCents: 400000 }]);
  });
});

describe("the ladder", () => {
  const lg = { id: "House", name: "House", recommendedMonthlyCents: 10000, complete: false, plannedCostCents: 400000 };
  test("a planned cost is a rung inside Salary to live, before the goal's savings rung", () => {
    const l = whatIfLadder(w(["House"]), base, [lg], "2026-10", a);
    expect(l.rungs.map((r) => [r.kind, r.id])).toEqual([["start", "start"], ["goal-cost", "cost:House"], ["goal", "House"]]);
    expect(l.rungs[1].monthlyCents).toBe(400000);
    expect(l.rungs[1].label).toBe("House, ongoing cost");
    const without = whatIfLadder(w(["House"]), base, [{ ...lg, plannedCostCents: 0 }], "2026-10", a);
    expect(l.salaryToLiveCents).toBeGreaterThan(without.salaryToLiveCents);
    expect(without.rungs.some((r) => r.kind === "goal-cost")).toBe(false);
  });
  test("an unticked goal's cost is not on the ladder", () => {
    const l = whatIfLadder(w([]), base, [lg], "2026-10", a);
    expect(l.rungs.some((r) => r.kind === "goal-cost")).toBe(false);
  });
  test("Check a salary prices the cost rung like any cost", () => {
    const l = whatIfLadder(w(["House"]), base, [lg], "2026-10", a);
    const check = checkSalary(l, 5_000_000, a, { whatIf: w(["House"]), baseLines: base });
    const item = check.items.find((i) => i.id === "cost:House")!;
    expect(item.kind).toBe("goal-cost");
    expect(item.covered).toBe(false); // $50,000 a year cannot carry rent plus a $4,000 mortgage
  });
});

describe("the composed what-if", () => {
  const scenario = { id: "s", name: "What if", income: { kind: "plan" }, expenseDeltas: [], lineOverrides: [] } as unknown as Scenario;
  test("a planned cost is its own line from next month, never before", () => {
    const s = composeWhatIf(scenario, w(["House"]), base, ["2026-09", "2026-10", "2026-11"], a, [{ goalId: "House", label: "House", monthlyCents: 400000 }], "2026-10");
    const houseDeltas = s.expenseDeltas.filter((d) => d.planningCategory === "Goal cost 1");
    expect(houseDeltas.map((d) => [d.period, d.deltaCents])).toEqual([["2026-10", 400000], ["2026-11", 400000]]);
  });
  test("applyWhatIfs carries the ticked goal's cost to the top bar and Runway", () => {
    const [s] = applyWhatIfs([scenario], [w(["House"])], base, a, "2026-09", [house]);
    expect(s.expenseDeltas.some((d) => d.planningCategory === "Goal cost 1" && d.period === "2026-10" && d.deltaCents === 400000)).toBe(true);
    expect(s.expenseDeltas.some((d) => d.planningCategory === "Goal cost 1" && d.period === "2026-09")).toBe(false);
  });
  test("without goals, applyWhatIfs is what it was", () => {
    const [s] = applyWhatIfs([scenario], [w(["House"])], base, a, "2026-09");
    expect(s.expenseDeltas.some((d) => d.planningCategory.startsWith("Goal cost"))).toBe(false);
  });
});

// The what-if's cost line is named so it can never read as income, and two goals with one name both count.
describe("the what-if's goal cost lines", () => {
  const scenario = { id: "s", name: "What if", income: { kind: "plan" }, expenseDeltas: [], lineOverrides: [] } as unknown as Scenario;
  test("a goal named like income is still a cost", () => {
    const s = composeWhatIf(scenario, w(["R"]), base, ["2026-10"], a, [{ goalId: "R", label: "Rental income property", monthlyCents: 300000 }], "2026-10");
    const d = s.expenseDeltas.find((x) => x.deltaCents === 300000)!;
    expect(isIncomeCategory(d.planningCategory)).toBe(false);
  });
  test("two ticked goals with the same name each get their own line", () => {
    const s = composeWhatIf(scenario, w(["A", "B"]), base, ["2026-10"], a, [{ goalId: "A", label: "House", monthlyCents: 100 }, { goalId: "B", label: "House", monthlyCents: 200 }], "2026-10");
    expect(new Set(s.expenseDeltas.map((x) => x.planningCategory)).size).toBe(2);
  });
});
