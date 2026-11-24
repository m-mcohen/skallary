import { expect, test } from "vitest";
import { expandChanges } from "../../src/domain/budget-changes";
import { resolveMonthlyPlan, usualMonthLines } from "../../src/domain/budget";
import type { BudgetChange, BudgetLine } from "../../src/domain/plan-types";

const P = "plan-2026";
const line = (cat: string, period: string | null, amountCents: number): BudgetLine => ({ planId: P, planningCategory: cat, period, amountCents });
let n = 0;
const change = (cat: string, fromMonth: string, amountCents: number, reason: "changed" | "goal" = "changed"): BudgetChange =>
  ({ id: ++n, planId: P, planningCategory: cat, fromMonth, amountCents, reason, goalId: reason === "goal" ? `g${n}` : null, createdAt: "" });

test("a change holds from its month on, later changes win, earlier months keep the usual amount", () => {
  const out = expandChanges([line("Groceries", null, 800)], [change("Groceries", "2026-10", 900), change("Groceries", "2027-02", 950)], "2027-03");
  expect(resolveMonthlyPlan(out, "Groceries", "2026-09")).toBe(800);
  expect(resolveMonthlyPlan(out, "Groceries", "2026-10")).toBe(900);
  expect(resolveMonthlyPlan(out, "Groceries", "2027-01")).toBe(900); // past the plan's end
  expect(resolveMonthlyPlan(out, "Groceries", "2027-02")).toBe(950);
});

test("a goal adds on top of the amount in force, before and after your change", () => {
  const out = expandChanges([line("Gym", null, 0)], [change("Gym", "2026-03", 200, "goal"), change("Gym", "2026-10", 900)], "2026-12");
  expect(resolveMonthlyPlan(out, "Gym", "2026-02")).toBe(0);
  expect(resolveMonthlyPlan(out, "Gym", "2026-03")).toBe(200);
  expect(resolveMonthlyPlan(out, "Gym", "2026-10")).toBe(1100);
});

test("a real one-month row wins and gets no second row", () => {
  const out = expandChanges([line("Gifts", null, 100), line("Gifts", "2026-12", 500)], [change("Gifts", "2026-10", 150)], "2026-12");
  expect(out.filter((l) => l.planningCategory === "Gifts" && l.period === "2026-12")).toHaveLength(1);
  expect(resolveMonthlyPlan(out, "Gifts", "2026-12")).toBe(500);
  expect(out.find((l) => l.period === "2026-11")?.origin).toBe("change");
});

test("no changes, no new rows", () => {
  const lines = [line("Groceries", null, 800)];
  expect(expandChanges(lines, [], "2026-12")).toEqual(lines);
});

test("the usual month at a month follows your changes but not a one-month amount", () => {
  const lines = expandChanges([line("Groceries", null, 800), line("Gifts", null, 100), line("Gifts", "2026-12", 500)],
    [change("Groceries", "2026-10", 900)], "2027-12");
  const sep = usualMonthLines(lines, "2026-09");
  const nov = usualMonthLines(lines, "2026-11");
  const dec = usualMonthLines(lines, "2026-12");
  expect(sep.find((l) => l.planningCategory === "Groceries")?.amountCents).toBe(800);
  expect(nov.find((l) => l.planningCategory === "Groceries")?.amountCents).toBe(900);
  expect(dec.find((l) => l.planningCategory === "Gifts")?.amountCents).toBe(100);
  expect(dec.every((l) => l.period === null)).toBe(true);
});
