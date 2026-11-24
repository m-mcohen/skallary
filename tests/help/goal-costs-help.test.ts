// tests/help/goal-costs-help.test.ts -- the help says what goals now do
//
import { describe, expect, test } from "vitest";
import { findTerm } from "../../src/help/glossary";
import { HELP_SCREENS } from "../../src/help";

const screen = (key: string) => HELP_SCREENS.find((s) => s.key === key)!;

describe("goal costs in help", () => {
  test("the three new terms exist and each is linked from an article", () => {
    for (const id of ["ongoing-cost", "fully-saved", "mark-complete"]) {
      expect(findTerm(id)?.definition, id).toBeTruthy();
      expect(HELP_SCREENS.some((s) => s.termIds.includes(id)), `${id} linked`).toBe(true);
    }
  });

  test("Goals no longer claims goals never change the budget", () => {
    expect(screen("goals.goals").purpose).not.toMatch(/tracking only|never change the budget/);
    expect(screen("goals.goals").purpose).toMatch(/ongoing cost/);
  });

  test("the Dashboard's Goals entry no longer says a finished goal reads Done", () => {
    const goals = screen("dashboard").numbers?.find((n) => n.label === "Goals");
    expect(goals?.how).not.toMatch(/reads Done/);
    expect(goals?.how).toMatch(/Fully saved/);
  });

  test("What if explains the ongoing cost rung", () => {
    expect(screen("whatif").numbers?.some((n) => /ongoing cost/i.test(n.label))).toBe(true);
    expect(screen("whatif").termIds).toContain("ongoing-cost");
  });
});
