import { describe, expect, test } from "vitest";
import { composeViewLines, viewTotals } from "../../src/domain/lifestyle-view";
import type { BudgetLine } from "../../src/domain/plan-types";
import type { Scenario } from "../../src/domain/scenario";

const dflt = (cat: string, cents: number): BudgetLine => ({ planId: "p1", planningCategory: cat, period: null, amountCents: cents });
const BASE = [dflt("Rent", 210_000), dflt("Groceries", 65_000), dflt("Coffee Shops", 3_000), dflt("Charity", 50_000), dflt("Income", 500_000), dflt("Weird thing", 1_000)];
const view = (overrides: Scenario["lineOverrides"]): Scenario => ({ id: "v", planId: "p1", name: "Planned life", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "", lineOverrides: overrides });
const P = "2026-10";

describe("composeViewLines", () => {
  test("no scenario: every expense default at its base amount, income excluded, numbered by group", () => {
    const groups = composeViewLines(BASE, null, P);
    const housing = groups.find((g) => g.name === "Housing")!;
    expect(housing.number).toBe("1");
    expect(housing.lines[0]).toMatchObject({ planningCategory: "Rent", number: "1.1", baseCents: 210_000, viewCents: 210_000, cut: false, hasOverride: false });
    expect(groups.flatMap((g) => g.lines).some((l) => l.planningCategory === "Income")).toBe(false);
    expect(groups[groups.length - 1].name).toBe("Other");
  });

  test("an override sets the view amount; a cut zeroes it; a new category appears in its group", () => {
    const groups = composeViewLines(BASE, view([
      { planningCategory: "Rent", amountCents: 450_000, cut: false, note: "new place", baseAmountCents: 210_000, updatedAt: "" },
      { planningCategory: "Coffee Shops", amountCents: null, cut: true, note: "", baseAmountCents: 3_000, updatedAt: "" },
      { planningCategory: "Auto Payment", amountCents: 70_000, cut: false, note: "", baseAmountCents: null, updatedAt: "" },
    ]), P);
    const line = (c: string) => groups.flatMap((g) => g.lines).find((l) => l.planningCategory === c)!;
    expect(line("Rent")).toMatchObject({ viewCents: 450_000, note: "new place", hasOverride: true });
    expect(line("Coffee Shops")).toMatchObject({ viewCents: 0, cut: true });
    expect(line("Auto Payment")).toMatchObject({ baseCents: 0, viewCents: 70_000 });
    expect(groups.find((g) => g.name === "Transportation")!.lines.map((l) => l.planningCategory)).toContain("Auto Payment");
  });

  test("base moved: the saved base differs from today's base", () => {
    const groups = composeViewLines(BASE, view([{ planningCategory: "Groceries", amountCents: 80_000, cut: false, note: "", baseAmountCents: 90_000, updatedAt: "" }]), P);
    expect(groups.flatMap((g) => g.lines).find((l) => l.planningCategory === "Groceries")!.baseMovedFromCents).toBe(90_000);
  });

  test("expense deltas are part of the view too", () => {
    const s = { ...view([]), expenseDeltas: [{ planningCategory: "Groceries", period: null, deltaCents: -5_000 }] };
    expect(composeViewLines(BASE, s, P).flatMap((g) => g.lines).find((l) => l.planningCategory === "Groceries")!.viewCents).toBe(60_000);
  });
});

describe("viewTotals", () => {
  test("need excludes Charity; Charity is reported separately; changed lines counted", () => {
    const groups = composeViewLines(BASE, view([
      { planningCategory: "Rent", amountCents: 450_000, cut: false, note: "", baseAmountCents: 210_000, updatedAt: "" },
      { planningCategory: "Charity", amountCents: null, cut: true, note: "inside the pot", baseAmountCents: 50_000, updatedAt: "" },
    ]), P);
    const t = viewTotals(groups);
    expect(t.needExCharityCents).toBe(450_000 + 65_000 + 3_000 + 1_000);
    expect(t.charityLineCents).toBe(0);
    expect(t.changedLines).toBe(2);
  });
});
