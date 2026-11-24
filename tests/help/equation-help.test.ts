// tests/help/equation-help.test.ts
//
// The top bar is one statement:
// into the bank, less the pot's amount put away, less the budget, equals left over. Its four terms are
// in the glossary with their rules, and no help text still puts Drawable, Salary needed or
// Take-home needed on the top bar.
import { describe, expect, test } from "vitest";
import { GLOSSARY, findTerm } from "../../src/help/glossary";
import { HELP_SCREENS, helpByKey } from "../../src/help";

const all = () => JSON.stringify([HELP_SCREENS, GLOSSARY]);

describe("the equation in help", () => {
  test("each term of the statement is defined, with its rule in plain words", () => {
    expect(findTerm("into-the-bank")!.definition).toMatch(/after federal income tax, Social Security and Medicare, and benefits/);
    expect(findTerm("maaser-put-away")!.definition).toMatch(/its share of what lands in the bank/);
    expect(findTerm("spent-so-far")!.definition).toMatch(/Charity line is left out/);
    expect(findTerm("left-over")!.definition).toMatch(/In Month it is the same number as the Budget screen's Left over/);
    expect(findTerm("left-over")!.definition).toMatch(/this month and later count the budget/);
    expect(findTerm("left-over")!.definition).toMatch(/differs from the Year tab's Left over by this month's slice/);
    expect(findTerm("into-the-bank")!.definition).toMatch(/this month and later it comes from Settings, Salary/);
    expect(findTerm("into-the-bank")!.definition).toMatch(/months already finished count the income that actually landed/);
  });

  test("no help text puts Drawable, Salary needed or Take-home needed on the top bar", () => {
    expect(all()).not.toMatch(/(Salary needed|Take-home needed) \(top bar\)/);
    expect(all()).not.toMatch(/top bar and the Dashboard call Drawable/);
    expect(all()).not.toMatch(/the top bar's Monthly budget/);
    expect(all()).not.toMatch(/in the top bar says: both price a usual month/);
    expect(all()).not.toMatch(/the top bar then says with goals/);
  });

  test("Salary needed and Take-home needed are What if figures now", () => {
    const labels = helpByKey("whatif")!.numbers!.map((n) => n.label);
    expect(labels).toContain("Salary needed (What if)");
    expect(labels).toContain("Take-home needed (What if)");
  });
});
