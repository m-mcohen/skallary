// tests/help/usual-month-help.test.ts
//
// Salary needed, Take-home needed and the
// ladder price a usual month. Help, the glossary and "This page answers" say so in the
// same change, with one plain sentence on one-month amounts and one-offs.
import { describe, expect, test } from "vitest";
import { GLOSSARY, findTerm } from "../../src/help/glossary";
import { HELP_SCREENS, helpByKey } from "../../src/help";

const SENTENCE = "A one-month budget amount never moves Salary needed; a one-off belongs in a One-time cost row.";
const all = () => JSON.stringify([HELP_SCREENS, GLOSSARY]);
const text = (key: string) => JSON.stringify(helpByKey(key));

describe("the usual month in help", () => {
  test("nothing says Salary needed, Take-home needed or the ladder price next month", () => {
    expect(all()).not.toMatch(/Salary needed prices next month|priced next month|prices next month|the ladder prices: next month|amount next month|one-month amount where it has one|next month has one-month budget amounts/);
  });

  test("the plain sentence is on What if and in the glossary", () => {
    expect(text("whatif")).toContain(SENTENCE);
    expect(findTerm("salary-needed")!.definition).toContain(SENTENCE);
    expect(findTerm("price-month")!.term).toBe("Usual month");
    expect(findTerm("price-month")!.definition).toMatch(/every-month amount/);
  });

  test("Take-home needed is Monthly budget less the Charity line, plus goal savings, always", () => {
    const d = findTerm("take-home-needed")!.definition;
    expect(d).toMatch(/Monthly budget, less the Charity line \(the pot line covers it\), plus any goal savings switched on/);
    expect(d).toMatch(/always/);
    expect(d).not.toMatch(/next month/);
  });

  test("What if's numbers name the usual month", () => {
    const n = (label: string) => helpByKey("whatif")!.numbers!.find((x) => x.label === label)!;
    expect(n("Priced for").meaning).toMatch(/usual month/);
    expect(n("Expenses").how).toMatch(/every-month amount/);
    expect(n("Today's costs, charity aside").how).toMatch(/every-month amount/);
    expect(n("Take-home needed (What if)").how).not.toMatch(/next month/);
    expect(findTerm("salary-to-live")!.definition).toMatch(/usual month/);
  });
});
