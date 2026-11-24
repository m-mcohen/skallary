import { describe, expect, test } from "vitest";
import { applyExpenseDeltas, applyLineOverrides, effectiveLineOverrides, type LineOverride } from "../../src/domain/scenario";
import { resolveMonthlyPlan } from "../../src/domain/budget";
import type { BudgetLine } from "../../src/domain/plan-types";

const dflt = (cat: string, cents: number): BudgetLine => ({ planId: "p1", planningCategory: cat, period: null, amountCents: cents });
const monthOverride = (cat: string, period: string, cents: number): BudgetLine => ({ planId: "p1", planningCategory: cat, period, amountCents: cents });
const H = ["2026-10", "2026-11", "2026-12"];
const ov = (o: Partial<LineOverride> & { planningCategory: string }): LineOverride => ({ amountCents: null, cut: false, note: "", baseAmountCents: null, updatedAt: "", ...o });

describe("applyLineOverrides", () => {
  test("a fixed amount replaces the line in every horizon month", () => {
    const out = applyLineOverrides([dflt("Rent", 210_000)], [ov({ planningCategory: "Rent", amountCents: 450_000 })], H);
    for (const p of H) expect(resolveMonthlyPlan(out, "Rent", p)).toBe(450_000);
  });

  test("a cut makes the line zero even when it has an amount", () => {
    const out = applyLineOverrides([dflt("Coffee Shops", 3_000)], [ov({ planningCategory: "Coffee Shops", amountCents: 2_000, cut: true })], H);
    expect(resolveMonthlyPlan(out, "Coffee Shops", "2026-11")).toBe(0);
  });

  test("a category the base lacks becomes a line in the view", () => {
    const out = applyLineOverrides([dflt("Rent", 210_000)], [ov({ planningCategory: "Second car", amountCents: 70_000 })], H);
    expect(resolveMonthlyPlan(out, "Second car", "2026-12")).toBe(70_000);
  });

  test("a note-only override changes nothing", () => {
    const lines = [dflt("Rent", 210_000)];
    expect(applyLineOverrides(lines, [ov({ planningCategory: "Rent", note: "keep" })], H)).toEqual(lines);
  });

  test("income categories are ignored", () => {
    const lines = [dflt("Income", 500_000)];
    expect(applyLineOverrides(lines, [ov({ planningCategory: "Income", amountCents: 0, cut: true })], H)).toEqual(lines);
  });

  test("a per-month base override is replaced too: a view is a steady state", () => {
    const lines = [dflt("Rent", 210_000), monthOverride("Rent", "2026-11", 300_000)];
    const out = applyLineOverrides(lines, [ov({ planningCategory: "Rent", amountCents: 450_000 })], H);
    expect(resolveMonthlyPlan(out, "Rent", "2026-11")).toBe(450_000);
  });

  test("applied after deltas, the override wins", () => {
    const withDelta = applyExpenseDeltas([dflt("Groceries", 65_000)], [{ planningCategory: "Groceries", period: null, deltaCents: -20_000 }], H);
    const out = applyLineOverrides(withDelta, [ov({ planningCategory: "Groceries", amountCents: 80_000 })], H);
    expect(resolveMonthlyPlan(out, "Groceries", "2026-10")).toBe(80_000);
  });

  test("no overrides returns the same array", () => {
    const lines = [dflt("Rent", 210_000)];
    expect(applyLineOverrides(lines, [], H)).toBe(lines);
  });
});

describe("effectiveLineOverrides", () => {
  test("drops note-only and income overrides, keeps cut and amount ones", () => {
    const noteOnly = ov({ planningCategory: "Rent", note: "keep" });
    const income = ov({ planningCategory: "Income", amountCents: 0, cut: true });
    const cut = ov({ planningCategory: "Coffee Shops", amountCents: 2_000, cut: true });
    const amount = ov({ planningCategory: "Rent", amountCents: 450_000 });
    expect(effectiveLineOverrides([noteOnly, income, cut, amount])).toEqual([cut, amount]);
  });
});
