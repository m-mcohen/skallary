// tests/help/followups-help.test.ts
//
// Help, the glossary and "This page answers" change in the same change as each item they describe.
import { describe, expect, test } from "vitest";
import { GLOSSARY, findTerm } from "../../src/help/glossary";
import { HELP_SCREENS, helpByKey } from "../../src/help";

const text = (key: string) => JSON.stringify(helpByKey(key));
const all = () => JSON.stringify([HELP_SCREENS, GLOSSARY]);

describe("Reports", () => {
  test("the monthly average divides by complete months only, in Reports as on the merchant page", () => {
    expect(text("reports")).toMatch(/complete months only/);
    expect(text("reports")).not.toMatch(/counts only for its days/);
  });

  test("Regular is always side by side", () => {
    expect(text("reports")).toMatch(/Regular puts the same columns side by side/);
    expect(text("reports")).not.toMatch(/up to 5 chosen categories/);
  });

  test("a click on a month or week narrows the whole page, and the page says it answers for one month too", () => {
    expect(text("reports")).toMatch(/narrows the whole page/);
    expect(helpByKey("reports")!.answers).toBe("How much went out, where did it go, over the period or one month of it, and how does it compare?");
  });
});

describe("the salary ladder and the top bar", () => {
  test("Take-home pay and Left for the budget are gone from every article and the glossary", () => {
    expect(all()).not.toMatch(/Take-home pay|take-home pay|Left for the budget|left for the budget/);
    expect(findTerm("take-home-pay")).toBeUndefined();
  });

  test("Take-home is after the pot; Take-home needed is the bridge line's figure", () => {
    expect(findTerm("take-home")!.definition).toMatch(/after the pot/);
    expect(findTerm("take-home-needed")!.definition).toMatch(/Monthly budget, less the Charity line/);
    expect(helpByKey("whatif")!.termIds).toEqual(expect.arrayContaining(["take-home", "take-home-needed", "maaser", "one-time-cost"]));
  });

  test("the ladder's lines in order, with Expenses and the what-if rows, are explained", () => {
    const labels = helpByKey("whatif")!.numbers!.map((n) => n.label);
    for (const label of ["The income statement", "Take-home", "Expenses", "What-if rows switched on", "Left over or short", "Monthly or Yearly", "Take-home needed (What if)"]) {
      expect(labels, label).toContain(label);
    }
    expect(text("whatif")).toMatch(/Charity line is left out of Expenses/);
  });

  test("Salary needed says with goals when a goal saving is on", () => {
    expect(findTerm("salary-needed")!.definition).toMatch(/with goals/);
  });
});

describe("Settings, Salary", () => {
  test("firm tax figures for the current salary, and a premium left blank, are explained", () => {
    expect(text("settings.salary")).toMatch(/firm/);
    expect(text("settings.salary")).toMatch(/current salary only/);
    expect(text("settings.salary")).toMatch(/estimated/);
    expect(text("settings.salary")).not.toMatch(/Clearing a box saves it as zero/);
    // The figures are typed a paycheck, so the line says each paycheck.
    expect(helpByKey("settings.salary")!.answers).toBe("What do I earn now, what comes out of each paycheck, and what does Salary needed assume?");
  });
});

describe("Settings, Merchants", () => {
  test("the old Zelle switch is explained, off until turned on", () => {
    expect(text("settings.merchants")).toMatch(/Show names from Zelle payment notes/);
    expect(text("settings.merchants")).not.toMatch(/stay one merchant, Zelle/);
    expect(findTerm("old-zelle-payments")!.definition).toMatch(/starts off/);
  });
});

describe("One-time cost", () => {
  test("What if and Forecast explain it; the old limit is gone", () => {
    expect(findTerm("one-time-cost")!.definition).toMatch(/once, in its month/);
    expect(helpByKey("whatif")!.howTo!.map((h) => h.title)).toContain("Add a one-time cost");
    expect(text("whatif")).not.toMatch(/A one-time cost cannot be shown/);
    expect(text("forecast")).toMatch(/one-time cost/i);
  });
});
