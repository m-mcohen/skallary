import { describe, it, expect } from "vitest";
import {
  addMonths,
  applyIncomeRamp,
  applyExpenseDeltas,
  type Scenario,
} from "../../src/domain/scenario";
import { resolveMonthlyPlan } from "../../src/domain/budget";
import { INCOME_CATEGORY } from "../../src/domain/runway-projection";
import type { BudgetLine } from "../../src/domain/plan-types";

const dflt = (cat: string, cents: number): BudgetLine => ({
  planId: "p1",
  planningCategory: cat,
  period: null,
  amountCents: cents,
});
const override = (cat: string, period: string, cents: number): BudgetLine => ({
  planId: "p1",
  planningCategory: cat,
  period,
  amountCents: cents,
});

const HORIZON = ["2026-09", "2026-10", "2026-11", "2026-12"];

describe("applyIncomeRamp", () => {
  it("kind:plan is a no-op — returns the input unchanged", () => {
    const lines = [dflt("Groceries", 100000), dflt(INCOME_CATEGORY, 500000)];
    const out = applyIncomeRamp(lines, { kind: "plan" }, HORIZON);
    expect(out).toBe(lines); // same reference: zero mutation
  });

  it("kind:custom materializes a flat net/mo from startPeriod onward", () => {
    const lines = [dflt(INCOME_CATEGORY, 0)];
    const out = applyIncomeRamp(
      lines,
      { kind: "custom", netMonthlyCents: 700_000, startPeriod: "2026-10" },
      HORIZON,
    );
    expect(resolveMonthlyPlan(out, INCOME_CATEGORY, "2026-09")).toBe(0);
    expect(resolveMonthlyPlan(out, INCOME_CATEGORY, "2026-10")).toBe(700_000);
    expect(resolveMonthlyPlan(out, INCOME_CATEGORY, "2026-12")).toBe(700_000);
  });

  it("kind:schedule picks the latest step whose fromPeriod <= period, 0 before the first step", () => {
    const lines = [dflt(INCOME_CATEGORY, 0)];
    const out = applyIncomeRamp(
      lines,
      {
        kind: "schedule",
        steps: [
          { fromPeriod: "2026-10", netMonthlyCents: 400_000 },
          { fromPeriod: "2026-11", netMonthlyCents: 600_000 },
        ],
      },
      HORIZON,
    );
    expect(resolveMonthlyPlan(out, INCOME_CATEGORY, "2026-09")).toBe(0); // before first step
    expect(resolveMonthlyPlan(out, INCOME_CATEGORY, "2026-10")).toBe(400_000);
    expect(resolveMonthlyPlan(out, INCOME_CATEGORY, "2026-11")).toBe(600_000);
    expect(resolveMonthlyPlan(out, INCOME_CATEGORY, "2026-12")).toBe(600_000); // latest step still applies
  });

  it("replaces an existing real Income override for an overlaid period rather than losing to it", () => {
    const lines = [dflt(INCOME_CATEGORY, 0), override(INCOME_CATEGORY, "2026-10", 111_111)];
    const out = applyIncomeRamp(
      lines,
      { kind: "custom", netMonthlyCents: 700_000, startPeriod: "2026-09" },
      HORIZON,
    );
    expect(resolveMonthlyPlan(out, INCOME_CATEGORY, "2026-10")).toBe(700_000);
  });
});

describe("applyExpenseDeltas", () => {
  it("a null-period delta lowers every horizon month's resolved amount by the delta", () => {
    const lines = [dflt("Groceries", 100_000)];
    const out = applyExpenseDeltas(lines, [{ planningCategory: "Groceries", period: null, deltaCents: -10_000 }], HORIZON);
    for (const period of HORIZON) {
      expect(resolveMonthlyPlan(out, "Groceries", period)).toBe(90_000);
    }
  });

  it("a single-month delta hits only that month", () => {
    const lines = [dflt("Groceries", 100_000)];
    const out = applyExpenseDeltas(
      lines,
      [{ planningCategory: "Groceries", period: "2026-11", deltaCents: -10_000 }],
      HORIZON,
    );
    expect(resolveMonthlyPlan(out, "Groceries", "2026-09")).toBe(100_000);
    expect(resolveMonthlyPlan(out, "Groceries", "2026-11")).toBe(90_000);
    expect(resolveMonthlyPlan(out, "Groceries", "2026-12")).toBe(100_000);
  });

  it("adds to an existing override's resolved amount rather than replacing the override mechanism", () => {
    const lines = [dflt("Shopping", 50_000), override("Shopping", "2026-10", 80_000)];
    const out = applyExpenseDeltas(lines, [{ planningCategory: "Shopping", period: null, deltaCents: -5_000 }], HORIZON);
    expect(resolveMonthlyPlan(out, "Shopping", "2026-10")).toBe(75_000); // override + delta
    expect(resolveMonthlyPlan(out, "Shopping", "2026-09")).toBe(45_000); // default + delta
  });

  it("a delta on a category absent from budgetLines resolves from a 0 base", () => {
    const lines = [dflt("Groceries", 100_000)];
    const out = applyExpenseDeltas(lines, [{ planningCategory: "New Cat", period: null, deltaCents: 5_000 }], HORIZON);
    expect(resolveMonthlyPlan(out, "New Cat", "2026-09")).toBe(5_000);
  });

  it("empty deltas is a no-op — returns the input unchanged", () => {
    const lines = [dflt("Groceries", 100_000)];
    expect(applyExpenseDeltas(lines, [], HORIZON)).toBe(lines);
  });

  it("a null-period delta with fromPeriod applies from that month to the end of the horizon, none before", () => {
    const lines = [dflt("Charity", 50_000)];
    const out = applyExpenseDeltas(
      lines,
      [{ planningCategory: "Charity", period: null, fromPeriod: "2026-11", deltaCents: 10_000 }],
      HORIZON,
    );
    expect(resolveMonthlyPlan(out, "Charity", "2026-09")).toBe(50_000);
    expect(resolveMonthlyPlan(out, "Charity", "2026-10")).toBe(50_000);
    expect(resolveMonthlyPlan(out, "Charity", "2026-11")).toBe(60_000);
    expect(resolveMonthlyPlan(out, "Charity", "2026-12")).toBe(60_000);
  });

  it("a fromPeriod past the horizon applies nowhere; a horizon that has slid past it applies everywhere", () => {
    const lines = [dflt("Charity", 50_000)];
    const delta = { planningCategory: "Charity", period: null, fromPeriod: "2026-11", deltaCents: 10_000 };
    const before = applyExpenseDeltas(lines, [{ ...delta, fromPeriod: "2027-06" }], HORIZON);
    for (const period of HORIZON) expect(resolveMonthlyPlan(before, "Charity", period)).toBe(50_000);
    const later = ["2027-06", "2027-07"];
    const after = applyExpenseDeltas(lines, [delta], later);
    for (const period of later) expect(resolveMonthlyPlan(after, "Charity", period)).toBe(60_000);
  });
});

describe("addMonths", () => {
  it("rolls over into the next year", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  it("does not overflow at month-end (calendar month arithmetic, not a Date object)", () => {
    expect(addMonths("2026-08", 1)).toBe("2026-09");
  });

  it("rolls backward over a year boundary too", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});
