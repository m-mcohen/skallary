// @vitest-environment jsdom
// tests/ui/LadderYourIncome.test.tsx
// The ladder's layout: Your income first, at the current salary, so
// Left over is a true number; Expenses fold open and shut; the two break-even totals sit
// in one section, Salary you would need, that starts collapsed. Figures come from the
// domain functions, never typed as literals.
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LadderPanel, { EXPENSES_OPEN_KEY, NEEDED_OPEN_KEY } from "../../src/ui/what-if/LadderPanel";
import { whatIfLadder, type WhatIf } from "../../src/domain/what-if";
import { DEFAULT_SALARY_ASSUMPTIONS, type SalaryAssumptions } from "../../src/domain/salary";
import { statementCents } from "../../src/domain/income-statement";
import { formatCents, formatWholeDollars } from "../../src/domain/money";
import type { BudgetLine } from "../../src/domain/plan-types";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const lines: BudgetLine[] = [
  { planId: "p", planningCategory: "Rent", period: null, amountCents: 250_000 },
  { planId: "p", planningCategory: "Groceries", period: null, amountCents: 90_000 },
  { planId: "p", planningCategory: "Charity", period: null, amountCents: 50_000 },
];
const a: SalaryAssumptions = {
  ...DEFAULT_SALARY_ASSUMPTIONS,
  premiumFromSettings: true,
  currentSalary: { kind: "gross", grossAnnualCents: 14_000_000, fromPeriod: "2026-11" },
};
const w: WhatIf = {
  scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null,
  changes: [{ id: "car", position: 1, kind: "add", label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2026-11", untilPeriod: null, loan: null }],
  rows: [],
};
const ladder = whatIfLadder(w, lines, [], "2026-11", a);
const mine = ladder.statements!.yourIncome!.statement;

const value = (testId: string, line: string) => screen.getByTestId(testId).querySelector(`[data-line='${line}'] [data-testid='statement-value']`)?.textContent;

describe("Your income", () => {
  test("comes first, at the current salary, with a real Left over", () => {
    render(<LadderPanel ladder={ladder} />);
    const panel = screen.getByTestId("ladder-panel-root");
    const first = panel.querySelector("[data-testid^='statement-']");
    expect(first?.getAttribute("data-testid")).toBe("statement-your-income");
    expect(screen.getByTestId("your-income-gross").textContent).toBe(`${formatWholeDollars(14_000_000)} a year`);
    expect(screen.getByTestId("statement-your-income").textContent).toContain("Your current salary (gross)");
    expect(value("statement-your-income", "take-home")).toBe(formatCents(statementCents(mine.monthly, "take-home")));
    expect(value("statement-your-income", "row:car")).toBe(formatCents(-70_000));
    expect(value("statement-your-income", "left-over")).toBe(formatCents(statementCents(mine.monthly, "left-over")));
    expect(statementCents(mine.monthly, "left-over")).toBeGreaterThan(100_000);
  });

  test("a what-if's own salary is named as its own", () => {
    const own = whatIfLadder({ ...w, salaryGrossAnnualCents: 12_000_000 }, lines, [], "2026-11", a);
    render(<LadderPanel ladder={own} />);
    expect(screen.getByTestId("statement-your-income").textContent).toContain("This what-if's salary (gross)");
    expect(screen.getByTestId("your-income-gross").textContent).toBe(`${formatWholeDollars(12_000_000)} a year`);
  });

  test("with no yearly salary it says what to type, in plain words", () => {
    const none = whatIfLadder(w, lines, [], "2026-11", { ...a, currentSalary: null });
    render(<LadderPanel ladder={none} />);
    expect(screen.queryByTestId("statement-your-income")).toBeNull();
    expect(screen.getByTestId("your-income-missing").textContent).toMatch(/yearly base salary under Settings, Salary/);
  });
});

describe("Expenses fold open and shut", () => {
  const expenseLines = () => screen.getByTestId("statement-your-income").querySelectorAll("[data-line^='expense:']");

  test("open at first; shut, they hide and the heading carries their sum; remembered", () => {
    const { unmount } = render(<LadderPanel ladder={ladder} />);
    expect(expenseLines().length).toBe(2);
    const heading = screen.getByTestId("statement-your-income").querySelector("[data-line='expenses']") as HTMLButtonElement;
    expect(heading.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(heading);
    expect(expenseLines().length).toBe(0);
    expect(screen.getByTestId("expenses-shut-total").textContent).toBe(formatCents(-(250_000 + 90_000)));
    // The total, the rows and Left over are still there.
    expect(value("statement-your-income", "in-all")).toBe(formatCents(statementCents(mine.monthly, "in-all")));
    expect(value("statement-your-income", "left-over")).toBe(formatCents(statementCents(mine.monthly, "left-over")));
    expect(window.localStorage.getItem(EXPENSES_OPEN_KEY)).toBe("false");
    unmount();
    render(<LadderPanel ladder={ladder} />);
    expect(expenseLines().length).toBe(0);
  });
});

describe("Salary you would need", () => {
  test("starts collapsed with both salaries named, opens to the two statements, and is remembered", () => {
    const { unmount } = render(<LadderPanel ladder={ladder} />);
    expect(screen.queryByTestId("statement-to-live")).toBeNull();
    expect(screen.getByTestId("salary-needed-summary").textContent).toBe(
      `To live: ${formatWholeDollars(ladder.salaryToLiveCents)} a year. To live and hit goals: ${formatWholeDollars(ladder.salaryToLiveAndHitGoalsCents)} a year.`
    );
    fireEvent.click(screen.getByRole("button", { name: "Salary you would need" }));
    expect(screen.getByTestId("statement-to-live")).toBeTruthy();
    expect(screen.getByTestId("statement-to-live-and-goals")).toBeTruthy();
    expect(window.localStorage.getItem(NEEDED_OPEN_KEY)).toBe("true");
    unmount();
    render(<LadderPanel ladder={ladder} />);
    expect(screen.getByTestId("statement-to-live")).toBeTruthy();
  });
});

describe("the Benefits line lists each benefit", () => {
  const list = [
    { name: "Health insurance", amountCents: 50_000, every: "month" as const, beforeTax: true },
    { name: "HSA", amountCents: 40_000, every: "month" as const, beforeTax: true },
  ];
  const withList = whatIfLadder(w, lines, [], "2026-11", { ...a, premiumMonthlyCents: 90_000, benefits: list });
  const items = () => screen.getByTestId("statement-your-income").querySelectorAll("[data-testid='benefit-item']");

  test("open at first: each benefit under the line, with its amount; shut, only the line; remembered", () => {
    const { unmount } = render(<LadderPanel ladder={withList} />);
    expect([...items()].map((el) => el.textContent)).toEqual([`Health insurance${formatCents(-50_000)}`, `HSA${formatCents(-40_000)}`]);
    const toggle = screen.getByTestId("statement-your-income").querySelector("[data-line='premium'] button") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(items().length).toBe(0);
    expect(value("statement-your-income", "premium")).toBe(formatCents(-90_000));
    unmount();
    render(<LadderPanel ladder={withList} />);
    expect(items().length).toBe(0);
  });

  test("with no list the Benefits line has no items and no fold", () => {
    render(<LadderPanel ladder={ladder} />);
    expect(items().length).toBe(0);
    expect(screen.getByTestId("statement-your-income").querySelector("[data-line='premium'] button")).toBeNull();
  });
});
