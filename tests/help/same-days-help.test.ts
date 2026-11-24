// tests/help/same-days-help.test.ts
//
// The Dashboard's spending card
// shows both same-days comparisons at once, the chart draws both comparison lines,
// the dropdown is gone, and each top category shows its spending by the same day last
// month. Help, the glossary and "This page answers" say so in the same change.
import { describe, expect, test } from "vitest";
import { GLOSSARY, findTerm } from "../../src/help/glossary";
import { HELP_SCREENS, helpByKey } from "../../src/help";

const dash = () => helpByKey("dashboard")!;
const number = (label: string) => dash().numbers!.find((n) => n.label === label)!;
const all = () => JSON.stringify([HELP_SCREENS, GLOSSARY]);

describe("help after both same-days comparisons", () => {
  test("nothing mentions the card's dropdown or a remembered pick any more", () => {
    expect(all()).not.toMatch(/card's dropdown|Pick the gray line|remembers your pick|vs\. average month picked|With vs\. average month/);
  });

  test("Spent this month names both comparisons, and which one opens a ledger", () => {
    const how = number("Spent this month").how;
    expect(number("Spent this month").meaning).toMatch(/same days of last month and of the average month/);
    expect(how).toMatch(/Last month, same days/);
    expect(how).toMatch(/12-month average, same days/);
    expect(how).toMatch(/3-month average, same days/);
    expect(how).toMatch(/not links/);
    expect(how).toMatch(/whole month before it and the whole average month/);
  });

  test("Spending by day draws both comparison lines, each named in the legend", () => {
    const n = number("Spending by day");
    expect(n.meaning).toMatch(/against last month and the average month/);
    expect(n.how).toMatch(/legend/);
    expect(n.how).toMatch(/dashed/);
  });

  test("Top categories says each shows the same day last month, and the month before in full on an earlier month", () => {
    const n = number("Top categories");
    expect(n.how).toMatch(/Last month/);
    expect(n.how).toMatch(/same day/);
    expect(n.how).toMatch(/\$0\.00/);
    expect(n.how).toMatch(/whole month before/);
    expect(dash().howTo!.find((h) => h.title === "Check the month")!.steps.join(" ")).toMatch(/same day last month/);
  });

  test("the glossary's Spent this month names both comparisons", () => {
    expect(findTerm("spent-this-month")!.definition).toMatch(/same days of last month and of the average month/);
    expect(findTerm("spent-this-month")!.definition).toMatch(/past month/);
  });

  test("This page answers keeps its question: how this month is going covers both comparisons", () => {
    expect(dash().answers).toBe("How is this month going, how did an earlier month end, and how close am I to my goals?");
  });
});
