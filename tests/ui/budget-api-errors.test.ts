// tests/ui/budget-api-errors.test.ts
// Every Budget write shows the server's own plain words when it is
// refused ("Months before this month are locked."), never "API /plans/... failed: 400".
import { afterEach, describe, expect, test, vi } from "vitest";
import { addBigMonthUI, applySetupUI, changeBudgetLineUI, setMonthNoteUI, startNextYearUI } from "../../src/ui/lib/db";

const refuse = (error: string) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error }) }) as unknown as Response));
const db = { base: "" };

afterEach(() => vi.unstubAllGlobals());

describe("Budget writes surface the server's words", () => {
  test("changing a line", async () => {
    refuse("Months before this month are locked.");
    await expect(changeBudgetLineUI(db, "plan-2026", "Groceries", "2026-01", 100)).rejects.toThrow("Months before this month are locked.");
  });
  test("a big month and a note", async () => {
    refuse("Name the big month.");
    await expect(addBigMonthUI(db, "plan-2026", { planningCategory: "Gifts", month: "2026-12", label: "", amountCents: 1 })).rejects.toThrow("Name the big month.");
    refuse("Pick a budget line.");
    await expect(setMonthNoteUI(db, "plan-2026", "", "2026-10", "x")).rejects.toThrow("Pick a budget line.");
  });
  test("Set up budget and next year's budget", async () => {
    refuse("Pick a budget line.");
    await expect(applySetupUI(db, "plan-2026", [{ line: "", amountCents: 1 }])).rejects.toThrow("Pick a budget line.");
    refuse("A budget for 2027 already exists.");
    await expect(startNextYearUI(db, "plan-2026", [])).rejects.toThrow("A budget for 2027 already exists.");
  });
});
