import { describe, expect, test } from "vitest";
import { OTHER_GROUP, STARTER_LIFESTYLE_GROUPS, groupFor } from "../../src/domain/lifestyle-groups";
import { composeViewLines } from "../../src/domain/lifestyle-view";
import type { BudgetLine } from "../../src/domain/plan-types";

const line = (cat: string, cents: number): BudgetLine => ({ planId: "p1", planningCategory: cat, period: null, amountCents: cents });

describe("lifestyle groups", () => {
  test("groups come from the saved list, the starter groups when none is saved, Other when unmatched", () => {
    const saved = [{ id: 1, name: "Home", categories: ["Rent"] }];
    expect(groupFor("Rent", saved).name).toBe("Home");
    expect(groupFor("Rent").id).toBe(STARTER_LIFESTYLE_GROUPS.find((g) => g.categories.includes("Rent"))!.id);
    expect(groupFor("Unknown line", saved)).toBe(OTHER_GROUP);
  });

  test("the view uses the saved groups: their names and order, Other numbered after them", () => {
    const saved = [
      { id: 1, name: "Basics", categories: ["Groceries"] },
      { id: 2, name: "Home", categories: ["Rent"] },
    ];
    const groups = composeViewLines([line("Rent", 100_000), line("Groceries", 50_000), line("Odd one", 1_000)], null, "2026-10", saved);
    expect(groups.map((g) => [g.number, g.name])).toEqual([["1", "Basics"], ["2", "Home"], ["3", "Other"]]);
    expect(groups[2].lines[0]).toMatchObject({ planningCategory: "Odd one", number: "3.1" });
  });
});
