// tests/domain/goal-cost.test.ts
// A started cost changes the budget from its start month on, on a new line or an existing
// one. The cost is a goal change from the start month on, added on top of the line.
import { describe, expect, test } from "vitest";
import { costLinesToWrite, canTakeGoalCost } from "../../src/domain/goal-cost";
import { expandChanges } from "../../src/domain/budget-changes";
import { resolveMonthlyPlan } from "../../src/domain/budget";
import type { BudgetLine } from "../../src/domain/plan-types";

const plan = { planId: "p", planStartDate: "2026-01-01", planEndDate: "2026-12-31" };
const L = (planningCategory: string, period: string | null, amountCents: number): BudgetLine => ({ planId: "p", planningCategory, period, amountCents });
const run = (lines: BudgetLine[], line: string, mode: "new" | "existing", startPeriod = "2026-10") =>
  costLinesToWrite({ ...plan, lines, line, mode, monthlyCents: 20000, startPeriod });
/** The lines as the app reads them once the goal change is stored. */
const withGoal = (lines: BudgetLine[], r: { goalChange: { line: string; fromMonth: string; deltaCents: number } }) =>
  expandChanges(lines, [{ id: 1, planId: "p", planningCategory: r.goalChange.line, fromMonth: r.goalChange.fromMonth, amountCents: r.goalChange.deltaCents, reason: "goal", goalId: "g", createdAt: "" }], "2026-12");

describe("a new line", () => {
  test("a new line gets an every-month row of $0 and a goal change for the cost from the start month", () => {
    const r = run([L("Rent", null, 210000)], "Pottery class", "new");
    expect(r).toEqual({ write: [L("Pottery class", null, 0)], goalChange: { line: "Pottery class", fromMonth: "2026-10", deltaCents: 20000 }, line: "Pottery class" });
  });
  test("a name that already exists is refused, never merged", () => {
    expect(run([L("Fitness", null, 5000)], "Fitness", "new")).toEqual({
      error: "There is already a budget line called Fitness. Pick it under Add to an existing line, or choose another name.",
    });
  });
  test("a blank name is refused", () => {
    expect(run([], "  ", "new")).toEqual({ error: "Name the budget line." });
  });
});

describe("an existing line", () => {
  test("an existing line writes no rows, only a goal change for the cost from the start month", () => {
    expect(run([L("Fitness", null, 5000)], "Fitness", "existing")).toEqual({ write: [], goalChange: { line: "Fitness", fromMonth: "2026-10", deltaCents: 20000 }, line: "Fitness" });
  });
  test("with the goal change, months before the start keep their amount and the start month adds the cost", () => {
    const lines = [L("Groceries", null, 80000)];
    const r = costLinesToWrite({ lines, planId: "p", planStartDate: "2026-01-01", planEndDate: "2026-12-31", line: "Groceries", mode: "existing", monthlyCents: 5000, startPeriod: "2026-10" });
    if ("error" in r) throw new Error(r.error);
    const out = expandChanges(lines, [{ id: 1, planId: "p", planningCategory: "Groceries", fromMonth: r.goalChange.fromMonth, amountCents: r.goalChange.deltaCents, reason: "goal", goalId: "g", createdAt: "" }], "2026-12");
    expect(resolveMonthlyPlan(out, "Groceries", "2026-09")).toBe(80000);
    expect(resolveMonthlyPlan(out, "Groceries", "2026-10")).toBe(85000);
  });
  // A real one-month row wins its month.
  test("a month that already has its own amount keeps it, before and after the start", () => {
    const lines = [L("Fitness", null, 5000), L("Fitness", "2026-03", 9000), L("Fitness", "2026-11", 7000)];
    const r = run(lines, "Fitness", "existing");
    if ("error" in r) throw new Error(r.error);
    const out = withGoal(lines, r);
    expect(resolveMonthlyPlan(out, "Fitness", "2026-03")).toBe(9000);
    expect(resolveMonthlyPlan(out, "Fitness", "2026-10")).toBe(25000);
    expect(resolveMonthlyPlan(out, "Fitness", "2026-11")).toBe(7000);
  });
  test("a line that does not exist is refused", () => {
    expect(run([], "Fitness", "existing")).toEqual({ error: "There is no budget line called Fitness." });
  });
});

test("a start before the plan begins writes no earlier months", () => {
  const r = run([], "Mortgage", "new", "2025-12");
  expect(r).toEqual({ write: [L("Mortgage", null, 0)], goalChange: { line: "Mortgage", fromMonth: "2025-12", deltaCents: 20000 }, line: "Mortgage" });
});

// Any line whose name reads as income ("Paychecks", anything with "income") is income to
// the app, so a cost there would lengthen the runway instead of shortening it.
describe("income lines", () => {
  test("a new line whose name reads as income is refused", () => {
    expect(run([], "Rental income property", "new")).toEqual({ error: "A goal's cost cannot go on an income line. Choose another name or line." });
  });
  test("an existing income line is refused", () => {
    expect(run([L("Paychecks", null, 900000)], "Paychecks", "existing")).toEqual({ error: "A goal's cost cannot go on an income line. Choose another name or line." });
  });
});

// Names differing only in capitals or spacing are the same line.
describe("same name, different capitals or spacing", () => {
  const dup = { error: "There is already a budget line called Fitness. Pick it under Add to an existing line, or choose another name." };
  test("a new line named fitness is refused when Fitness exists", () => {
    expect(run([L("Fitness", null, 5000)], "fitness", "new")).toEqual(dup);
  });
  test("extra spaces inside or around the name do not make it new", () => {
    expect(run([L("Pottery  class", null, 5000)], " pottery class ", "new")).toEqual({
      error: "There is already a budget line called Pottery  class. Pick it under Add to an existing line, or choose another name.",
    });
  });
  test("an existing line typed in other capitals writes under the line's own name", () => {
    const r = run([L("Fitness", null, 5000)], "FITNESS", "existing");
    if ("error" in r) throw new Error(r.error);
    expect(r.line).toBe("Fitness");
    expect(r.write).toEqual([]);
    expect(r.goalChange.line).toBe("Fitness");
  });
});

// A line named like saving counts nowhere in the budget, so refuse it.
describe("saving lines", () => {
  const refusal = { error: "A goal's cost cannot go on a saving line such as Investing or Retirement. Choose another name or line." };
  test("a new line named Investing is refused", () => {
    expect(run([], "Investing", "new")).toEqual(refusal);
  });
  test("an existing Retirement line is refused, in any capitals", () => {
    expect(run([L("Retirement", null, 100000)], " retirement ", "existing")).toEqual(refusal);
  });
  test("investment income names are refused too", () => {
    expect(run([], "Dividends", "new")).toEqual(refusal);
  });
  test("the budget screen's existing-line list leaves them out", () => {
    expect(canTakeGoalCost("Investing")).toBe(false);
    expect(canTakeGoalCost("Paychecks")).toBe(false);
    expect(canTakeGoalCost("Fitness")).toBe(true);
  });
});

// Older versions allowed both "Fitness" and "fitness".
// Picking one of them must write to that one, not to whichever the capital-blind lookup meets first.
describe("two lines that differ only in capitals", () => {
  const both = [L("Fitness", null, 5000), L("fitness", null, 9000), L("fitness", "2026-11", 12000)];
  test("the line picked by its exact name is the line written", () => {
    const r = run(both, "fitness", "existing");
    if ("error" in r) throw new Error(r.error);
    expect(r.line).toBe("fitness");
    expect(r.goalChange.line).toBe("fitness");
    const out = withGoal(both, r);
    expect(resolveMonthlyPlan(out, "fitness", "2026-10")).toBe(29000); // its own 9,000 + 20,000, not Fitness's 5,000
    expect(resolveMonthlyPlan(out, "fitness", "2026-01")).toBe(9000);
    expect(resolveMonthlyPlan(out, "Fitness", "2026-10")).toBe(5000);
  });
  test("the other one is just as reachable", () => {
    const r = run(both, "Fitness", "existing");
    if ("error" in r) throw new Error(r.error);
    expect(r.line).toBe("Fitness");
    expect(r.goalChange.line).toBe("Fitness");
  });
  test("a name that matches both only by capitals is refused, never guessed", () => {
    expect(run(both, "FITNESS", "existing")).toEqual({
      error: "There is more than one budget line named like FITNESS (Fitness, fitness). Pick one by its exact name.",
    });
  });
  test("a new line is still refused as a duplicate", () => {
    const r = run(both, "FITNESS", "new");
    expect("error" in r && r.error).toContain("There is already a budget line called");
  });
});
