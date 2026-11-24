// tests/help/paycheck-help.test.ts
//
// The tax and premium boxes in Settings,
// Salary are typed a paycheck, with how often you are paid. Help, the glossary and "This
// page answers" say so in the same change, and nothing still says the tax boxes are yearly
// or the premium is typed a month.
//
// Benefits: the premium box became the Benefits list, so the how-to types the
// two tax figures from one paycheck and lists each benefit, a paycheck or a month.
import { describe, expect, test } from "vitest";
import { GLOSSARY, findTerm } from "../../src/help/glossary";
import { HELP_SCREENS, helpByKey } from "../../src/help";

const text = (key: string) => JSON.stringify(helpByKey(key));
const all = () => JSON.stringify([HELP_SCREENS, GLOSSARY]);

describe("Settings, Salary", () => {
  test("the page answers for each paycheck", () => {
    expect(helpByKey("settings.salary")!.answers).toBe("What do I earn now, what comes out of each paycheck, and what does Salary needed assume?");
  });

  test("the how-to: pick how often you are paid, type the two tax figures from one paycheck, then each benefit", () => {
    const s = text("settings.salary");
    expect(s).toMatch(/how often you are paid: Weekly, Every two weeks, Twice a month or Monthly/);
    expect(s).toMatch(/federal income tax and the Social Security and Medicare from one paycheck/);
    expect(s).toMatch(/Under Benefits, add one row per benefit you pay for: its name, the amount, a paycheck or a month, and Before tax/);
    expect(helpByKey("settings.salary")!.termIds).toContain("benefits");
    expect(s).toMatch(/what each comes to a month and a year/);
    expect(helpByKey("settings.salary")!.termIds).toContain("pay-schedule");
  });

  test("the limits: an older yearly tax figure stands until the paycheck figure replaces it; an older monthly premium shows as one Benefits row; paychecks a year", () => {
    const s = text("settings.salary");
    expect(s).toMatch(/A tax figure typed earlier as a yearly amount stays in force/);
    expect(s).toMatch(/typed earlier as a monthly amount shows as one row named Benefits/);
    expect(s).toMatch(/52, 26, 24 or 12 paychecks a year/);
  });

  // A blank box's grey text names what is in force, so the how-to no longer says a
  // blank box is simply estimated.
  test("a blank box keeps a figure typed earlier, or is estimated, and its grey text says which", () => {
    const s = text("settings.salary");
    expect(s).toMatch(/Leave a box blank to keep a figure typed earlier, or to estimate when there is none; the grey text in a blank box says which\./);
    expect(s).not.toMatch(/Leave a box blank to estimate\./);
  });

  test("nothing says the tax boxes are yearly or the premium is typed a month", () => {
    expect(all()).not.toMatch(/Social Security and Medicare a year/);
    expect(all()).not.toMatch(/type the monthly health premium/);
    expect(all()).not.toMatch(/firm yearly tax figures/);
  });
});

describe("the glossary", () => {
  test("Pay schedule is a term", () => {
    expect(findTerm("pay-schedule")!.term).toBe("Pay schedule");
    expect(findTerm("pay-schedule")!.definition).toMatch(/Weekly \(52 paychecks a year\), Every two weeks \(26\), Twice a month \(24\) or Monthly \(12\)/);
  });

  test("Benefits are typed a paycheck or a month, one row each; Current salary says its taxes are typed a paycheck", () => {
    expect(findTerm("benefits")!.term).toBe("Benefits");
    expect(findTerm("benefits")!.definition).toMatch(/one row per benefit, a paycheck or a month/);
    expect(findTerm("benefits")!.definition).toMatch(/Ticked Before tax, a benefit lowers the wages that are taxed/);
    expect(findTerm("health-premium")).toBeUndefined();
    expect(findTerm("current-salary")!.definition).toMatch(/a paycheck/);
  });

  test("nothing a reader sees still calls them the health premium", () => {
    expect(all()).not.toMatch(/the health premium/i);
  });
});

describe("Forecast and What if", () => {
  test("they call your typed taxes the paycheck figures", () => {
    expect(text("forecast")).toMatch(/Tax figures from your paycheck, typed under Settings, Salary/);
    expect(text("whatif")).toMatch(/typed your paycheck tax figures for your current salary/);
  });
});
