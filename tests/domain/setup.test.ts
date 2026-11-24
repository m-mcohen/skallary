import { expect, test } from "vitest";
import { applyTicked, basisLabel, setupLines, setupTotals } from "../../src/domain/setup";
import { expandChanges } from "../../src/domain/budget-changes";
import { resolveMonthlyPlan } from "../../src/domain/budget";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import { summariseForMasthead } from "../../src/ui/lib/instrument";
import type { BudgetChange, BudgetLine } from "../../src/domain/plan-types";
import type { LineSuggestion } from "../../src/domain/suggest";

const P = "plan-2026";
const line = (cat: string, amountCents: number, source: "you" | "suggested" = "suggested"): BudgetLine => ({ planId: P, planningCategory: cat, period: null, amountCents, source });
const sug = (cat: string, amountCents: number, kind: "bill" | "average" = "average"): LineSuggestion =>
  kind === "bill"
    ? { planningCategory: cat, amountCents, basis: { kind, bills: [{ label: "Comcast", cadence: "monthly", usualCents: amountCents }] } }
    : { planningCategory: cat, amountCents, basis: { kind, months: 12, emptyMonths: 2 } };
const goal: BudgetChange = { id: 7, planId: P, planningCategory: "Gym", fromMonth: "2026-03", amountCents: 20000, reason: "goal", goalId: "g1", createdAt: "" };
const mine: BudgetChange = { id: 8, planId: P, planningCategory: "Rent", fromMonth: "2026-10", amountCents: 210000, reason: "changed", goalId: null, createdAt: "" };
const base = [line("Groceries", 50000), line("Dining", 30000), line("Rent", 200000, "you"), line("Gym", 5000), line("Coffee", 4000)];
const changes = [goal, mine];
const lines = expandChanges(base, changes, "2027-12");
const suggestions = [sug("Groceries", 60000), sug("Dining", 31000), sug("Rent", 205000, "bill"), sug("Gym", 26000), sug("Coffee", 4000)];

test("every change starts ticked, small ones labeled; set-by-you lines start unticked with what they clear", () => {
  const rows = setupLines({ lines, changes, settings: [], suggestions, month: "2026-10" });
  const by = (n: string) => rows.find((r) => r.line === n)!;
  expect(by("Groceries")).toMatchObject({ nowCents: 50000, changeCents: 10000, small: false, startsTicked: true });
  expect(by("Dining")).toMatchObject({ changeCents: 1000, small: true, startsTicked: true });
  expect(by("Rent")).toMatchObject({ nowCents: 210000, setByYou: true, startsTicked: false });
  expect(by("Rent").clears).toEqual([mine]);
  expect(by("Coffee")).toMatchObject({ changeCents: 0, startsTicked: false });
});

test("a goal line: now includes the goal, Apply writes the suggestion less the goal, so the goal is not counted twice", () => {
  // The 12-month average already includes what the goal has been spending.
  const rows = setupLines({ lines, changes, settings: [], suggestions, month: "2026-10" });
  expect(rows.find((r) => r.line === "Gym")).toMatchObject({ nowCents: 25000, goalCents: 20000, changeCents: 1000, applyCents: 6000 });
  const after = applyTicked(lines, changes, [{ line: "Gym", amountCents: 6000 }], "2027-12");
  expect(resolveMonthlyPlan(after.lines, "Gym", "2026-10")).toBe(26000);
});

test("a goal larger than the suggestion leaves the line's own amount at zero; a refund line with no goal keeps its negative suggestion", () => {
  const rows = setupLines({ lines, changes, settings: [], suggestions: [sug("Gym", 15000), sug("Returns", -15000)], month: "2026-10" });
  expect(rows.find((r) => r.line === "Gym")?.applyCents).toBe(0);
  expect(rows.find((r) => r.line === "Returns")?.applyCents).toBe(-15000);
});

test("Apply on a set-by-you line clears your changes on it", () => {
  const after = applyTicked(lines, changes, [{ line: "Rent", amountCents: 205000 }], "2027-12");
  expect(after.changes.filter((c) => c.planningCategory === "Rent")).toHaveLength(0);
  expect(resolveMonthlyPlan(after.lines, "Rent", "2026-11")).toBe(205000);
});

test("the basis in words; a fixed line with no bill says so", () => {
  expect(basisLabel(sug("Rent", 205000, "bill"), true)).toBe("Bill: Comcast $2,050.00 every month");
  expect(basisLabel(sug("Groceries", 60000), false)).toBe("12-month average, 2 months with none");
  expect(basisLabel(sug("Groceries", 60000), true)).toBe("12-month average, no bill found");
});

test("totals before and after: Monthly budget, Left over a month and Salary needed", () => {
  const input = { lines, changes, bigMonths: [], settings: [], salary: { ...DEFAULT_SALARY_ASSUMPTIONS, currentSalary: { kind: "gross" as const, grossAnnualCents: 12_000_000, fromPeriod: "2026-11" } } };
  const need = (l: BudgetLine[]) =>
    summariseForMasthead({ accounts: [], balances: [], budgetLines: l, categorySettings: [], uncategorizedCount: 0, ruleCount: 0, lastSyncedAt: null, asOfDate: "2026-10-20", salaryAssumptions: input.salary }).salary?.grossAnnualCents ?? null;
  const before = setupTotals(input, "2026-10", "2026-10-20", need);
  const after = setupTotals({ ...input, ...applyTicked(lines, changes, [{ line: "Groceries", amountCents: 60000 }], "2027-12") }, "2026-10", "2026-10-20", need);
  expect(after.monthlyCents - before.monthlyCents).toBe(10000);
  expect(before.leftOverCents! - after.leftOverCents!).toBe(10000);
  expect(after.salaryNeededCents!).toBeGreaterThan(before.salaryNeededCents!);
});
