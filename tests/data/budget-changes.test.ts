import { beforeEach, expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";

let repo: NodeRepository;
const P = "plan-2026";
beforeEach(() => {
  repo = new NodeRepository(":memory:");
  repo.createPlan({ id: P, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" });
  repo.setBudgetLine({ planId: P, planningCategory: "Groceries", period: null, amountCents: 80000 });
});

test("an every-month row is suggested unless you set it, and keeps its source on a plain rewrite", () => {
  expect(repo.getBudgetLines(P)[0].source).toBe("suggested");
  repo.setBudgetLine({ planId: P, planningCategory: "Groceries", period: null, amountCents: 85000, source: "you" });
  repo.setBudgetLine({ planId: P, planningCategory: "Groceries", period: null, amountCents: 86000 });
  expect(repo.getBudgetLines(P)[0]).toMatchObject({ amountCents: 86000, source: "you" });
});

test("From a month on replaces that month's and later changed rows, keeps earlier ones, and says which", () => {
  repo.changeLineFrom(P, "Groceries", "2026-03", 90000);
  repo.changeLineFrom(P, "Groceries", "2026-11", 95000);
  const replaced = repo.changeLineFrom(P, "Groceries", "2026-10", 92000);
  expect(replaced.map((c) => c.fromMonth)).toEqual(["2026-11"]);
  expect(repo.listBudgetChanges(P).map((c) => [c.fromMonth, c.amountCents])).toEqual([
    ["2026-03", 90000],
    ["2026-10", 92000],
  ]);
});

test("Every month clears changed rows, sets the amount as the person's own, and leaves goal rows", () => {
  repo.changeLineFrom(P, "Groceries", "2026-10", 92000);
  repo.addGoalChange(P, "Groceries", "2026-03", 20000, "goal-1");
  const replaced = repo.setLineEveryMonth(P, "Groceries", 70000);
  expect(replaced.map((c) => c.fromMonth)).toEqual(["2026-10"]);
  expect(repo.listBudgetChanges(P).map((c) => c.reason)).toEqual(["goal"]);
  expect(repo.getBudgetLines(P)[0]).toMatchObject({ amountCents: 70000, source: "you" });
});

test("Go back to suggested clears changed rows, sets the suggestion as suggested, leaves goal rows", () => {
  repo.setLineEveryMonth(P, "Groceries", 70000);
  repo.changeLineFrom(P, "Groceries", "2026-10", 92000);
  repo.addGoalChange(P, "Groceries", "2026-03", 20000, "goal-1");
  const cleared = repo.resetLine(P, "Groceries", 81200);
  expect(cleared.map((c) => c.fromMonth)).toEqual(["2026-10"]);
  expect(repo.listBudgetChanges(P).map((c) => c.reason)).toEqual(["goal"]);
  expect(repo.getBudgetLines(P)[0]).toMatchObject({ amountCents: 81200, source: "suggested" });
});

test("every budget change write is logged", () => {
  repo.changeLineFrom(P, "Groceries", "2026-10", 92000);
  expect(repo.getChangeLog(`budget_change:${P}:Groceries`).length).toBe(1);
});

test("big months: add, read, update, delete", () => {
  const b = repo.addBigMonth({ planId: P, planningCategory: "Gifts", month: "2026-12", label: "Holiday gifts", amountCents: 80000 });
  expect(repo.listBigMonths(P)).toEqual([b]);
  repo.updateBigMonth(b.id, { planningCategory: "Gifts", month: "2026-12", label: "Holiday party", amountCents: 90000 });
  expect(repo.getBigMonth(b.id)).toMatchObject({ label: "Holiday party", amountCents: 90000 });
  repo.deleteBigMonth(b.id);
  expect(repo.listBigMonths(P)).toEqual([]);
});

test("a month note: set, replace, and an empty note deletes it", () => {
  repo.setMonthNote(P, "Gifts", "2026-12", "Holiday party");
  repo.setMonthNote(P, "Gifts", "2026-12", "Toy party");
  expect(repo.listMonthNotes(P).map((n) => n.note)).toEqual(["Toy party"]);
  repo.setMonthNote(P, "Gifts", "2026-12", "   ");
  expect(repo.listMonthNotes(P)).toEqual([]);
});

// Big months and notes append to change_log too.
test("big months and month notes are logged, the delete and the clear included", () => {
  const b = repo.addBigMonth({ planId: P, planningCategory: "Gifts", month: "2026-12", label: "Logged", amountCents: 1000 });
  repo.updateBigMonth(b.id, { planningCategory: "Gifts", month: "2026-12", label: "Logged", amountCents: 2000 });
  repo.deleteBigMonth(b.id);
  expect(repo.getChangeLog(`big_month:${b.id}`).map((e) => e.field)).toEqual(["added", "changed", "deleted"]);
  repo.setMonthNote(P, "Gifts", "2026-12", "Logged note");
  repo.setMonthNote(P, "Gifts", "2026-12", "");
  expect(repo.getChangeLog(`month_note:${P}:Gifts:2026-12`).map((e) => e.field)).toEqual(["note", "note"]);
});
