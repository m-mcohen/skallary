// @vitest-environment jsdom
// tests/ui/LadderPanel.test.tsx
// The salary ladder and Check a salary on the
// What if screen. The ladder has no controls: rows are
// switched and ordered in the list beside it (tests/ui/WhatIfSection.test.tsx).
// Figures are read from the domain functions, not typed as literals, so wording
// edits never break these tests.
import { afterEach, describe, expect, test, beforeEach } from "vitest";
import { NEEDED_OPEN_KEY } from "../../src/ui/what-if/LadderPanel";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import LadderPanel, { LADDER_VIEW_KEY } from "../../src/ui/what-if/LadderPanel";
import CheckSalaryBox from "../../src/ui/what-if/CheckSalaryBox";
import { checkSalary, whatIfLadder, type LadderGoal, type WhatIf } from "../../src/domain/what-if";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import { formatCents, formatWholeDollars } from "../../src/domain/money";
import type { BudgetLine } from "../../src/domain/plan-types";

// These tests read the two break-even statements, which sit in
// "Salary you would need", collapsed at first: open it before each test.
beforeEach(() => window.localStorage.setItem(NEEDED_OPEN_KEY, "true"));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/** Opens every "Show the ..." steps button (the cost rows sit under the budget line). */
function openSteps() {
  for (const b of screen.queryAllByRole("button", { name: /^Show the / })) fireEvent.click(b);
}

const lines: BudgetLine[] = [
  { planId: "p", planningCategory: "Rent", period: null, amountCents: 250_000 },
  { planId: "p", planningCategory: "Groceries", period: null, amountCents: 90_000 },
  { planId: "p", planningCategory: "Charity", period: null, amountCents: 50_000 },
];
const goals: LadderGoal[] = [
  { id: "house", name: "House", recommendedMonthlyCents: 450_000, complete: false, plannedCostCents: 0 },
  { id: "car2", name: "Second vehicle", recommendedMonthlyCents: 250_000, complete: false, plannedCostCents: 0 },
  { id: "trip", name: "Family trip", recommendedMonthlyCents: 90_000, complete: false, plannedCostCents: 0 },
];
const w: WhatIf = {
  scenarioId: "w1", salaryGrossAnnualCents: 12_000_000, salaryFromPeriod: "2026-11",
  changes: [
    { id: "car", position: 1, kind: "add", label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2027-03", untilPeriod: null, loan: null },
    { id: "uber", position: 2, kind: "cut", label: "Groceries", planningCategory: "Groceries", amountCents: 80_000, fromPeriod: "2026-10", untilPeriod: null, loan: null },
  ],
  rows: [
    { kind: "change", refId: "car", position: 1, on: true },
    { kind: "change", refId: "uber", position: 2, on: true },
    { kind: "goal-saving", refId: "car2", position: 3, on: true },
    { kind: "goal-saving", refId: "house", position: 4, on: true },
  ],
};
// A pot rate whose share passes the Charity line, so the pot line shows.
const a = { ...DEFAULT_SALARY_ASSUMPTIONS, maaserRate: 0.1, children: 1 };
const ladder = whatIfLadder(w, lines, goals, "2026-10", a);

const renderPanel = (over: Partial<Parameters<typeof LadderPanel>[0]> = {}) => render(<LadderPanel ladder={ladder} {...over} />);

describe("LadderPanel", () => {
  // With no goal ticked the second total equals the first,
  // which read as though the goals cost nothing.
  test("says No goals included beside the second total when no goal is ticked", () => {
    const none = whatIfLadder({ ...w, rows: [] }, lines, goals, "2026-10", a);
    renderPanel({ ladder: none });
    expect(screen.getByTestId("goals-included-note").textContent).toBe("No goals included");
  });

  test("says nothing extra once a goal saving row is on", () => {
    renderPanel();
    expect(screen.queryByTestId("goals-included-note")).toBeNull();
  });

  // The switches and arrows live on the list, so nothing here can be ticked or moved.
  test("has no controls of its own", () => {
    renderPanel();
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(screen.queryAllByRole("switch")).toEqual([]);
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
  });

  // The ladder prices a usual month, no longer next month.
  test("says it prices a usual month (no start months)", () => {
    renderPanel();
    expect(screen.getByTestId("price-month").textContent).toBe("Priced for a usual month: each budget line's every-month amount, with every row that is switched on.");
  });

  test("lists the start, each change in list order, then Salary to live, with the figures the ladder computes", () => {
    renderPanel();
    // The steps sit behind a button under each statement's budget line.
    openSteps();
    const rows = screen.getAllByTestId("ladder-rung");
    expect(rows.map((r) => r.getAttribute("data-rung-id"))).toEqual(["start", "car", "uber", "car2", "house"]);
    expect(within(rows[0]).getByText("Today's costs, charity aside")).toBeTruthy();
    expect(rows[1].textContent).toContain(`+${formatCents(70_000)} a month`);
    expect(rows[1].textContent).toContain(formatWholeDollars(ladder.rungs[1].salaryAfterCents));
    expect(rows[2].textContent).toContain(`-${formatCents(10_000)} a month`);
    // Every gross figure carries its unit.
    expect(screen.getByTestId("salary-to-live").textContent).toBe(`${formatWholeDollars(ladder.salaryToLiveCents)} a year`);
    expect(screen.getByTestId("salary-to-live-and-goals").textContent).toBe(`${formatWholeDollars(ladder.salaryToLiveAndHitGoalsCents)} a year`);
    expect(within(rows[1]).getByTestId("rung-salary").textContent).toBe(`${formatWholeDollars(ladder.rungs[1].salaryAfterCents)} a year`);
    // The step's increase is named for a screen reader, not just a bare figure.
    expect(within(rows[1]).getByTestId("rung-added").getAttribute("aria-label")).toBe(
      `Adds ${formatWholeDollars(ladder.rungs[1].salaryAddedCents)} a year of salary`
    );
  });

  // Take-home needed (net), a month and a year, on
  // every step and on both totals, beside the gross salary.
  const net = (annual: number) => `Take-home ${formatWholeDollars(Math.round(annual / 12))} a month (${formatWholeDollars(annual)} a year)`;

  test("every step shows the take-home it needs, a month and a year", () => {
    renderPanel();
    openSteps();
    for (const row of screen.getAllByTestId("ladder-rung")) {
      const rung = ladder.rungs.find((r) => r.id === row.getAttribute("data-rung-id"))!;
      expect(rung.takeHomeAfterCents).toBeGreaterThan(0);
      expect(rung.takeHomeAfterCents).toBeLessThan(rung.salaryAfterCents);
      expect(within(row).getByTestId("rung-take-home").textContent).toBe(net(rung.takeHomeAfterCents));
    }
  });

  test("both totals say gross, a year, above their statements", () => {
    renderPanel();
    expect(screen.getByText(/^= Salary to live \(gross\)$/)).toBeTruthy();
    expect(screen.getByText(/^= Salary to live and hit goals \(gross\)$/)).toBeTruthy();
  });

  test("a goal's note shows under its step", () => {
    const done = [{ id: "trip", name: "Family trip", recommendedMonthlyCents: null, complete: true, plannedCostCents: 0 }];
    const l = whatIfLadder({ ...w, changes: [], rows: [{ kind: "goal-saving", refId: "trip", position: 1, on: true }] }, lines, done, "2026-10", a);
    render(<LadderPanel ladder={l} />);
    openSteps();
    expect(screen.getByText("Fully saved, nothing more needed")).toBeTruthy();
  });
});

describe("CheckSalaryBox", () => {
  test("walks the list order and says covered or not covered, then what is left each month", () => {
    render(<CheckSalaryBox ladder={ladder} assumptions={a} initialSalaryCents={null} />);
    fireEvent.change(screen.getByLabelText("Salary to check"), { target: { value: "120,000" } });
    const r = checkSalary(ladder, 12_000_000, a);
    const items = screen.getAllByTestId("check-item");
    expect(items.map((i) => i.textContent)).toEqual(r.items.map((i) => `${i.label}: ${i.covered ? "covered" : "not covered"}`));
    expect(screen.getByTestId("check-left").textContent).toBe(`Left over each month ${formatCents(r.leftOverMonthlyCents)}`);
  });

  test("a salary below today's costs says so", () => {
    render(<CheckSalaryBox ladder={ladder} assumptions={a} initialSalaryCents={null} />);
    fireEvent.change(screen.getByLabelText("Salary to check"), { target: { value: "20,000" } });
    expect(screen.getByText("This salary does not cover today's costs.")).toBeTruthy();
  });

  test("opens on the what-if's own salary when it has one, and says nothing until a salary is typed otherwise", () => {
    render(<CheckSalaryBox ladder={ladder} assumptions={a} initialSalaryCents={12_000_000} />);
    expect((screen.getByLabelText("Salary to check") as HTMLInputElement).value).toBe("120,000");
    cleanup();
    render(<CheckSalaryBox ladder={ladder} assumptions={a} initialSalaryCents={null} />);
    expect(screen.queryAllByTestId("check-item")).toEqual([]);
  });
});



// The ladder reads like an income statement, one per
// total, with a Monthly | Yearly switch that flips every line.
describe("LadderPanel, the income statements", () => {
  const lineTexts = (testId: string) =>
    [...screen.getByTestId(testId).querySelectorAll("[data-testid='statement-line']")].map((el) => [el.getAttribute("data-line"), el.querySelector("[data-testid='statement-value']")!.textContent]);
  const expected = (lines: { id: string; cents: number; heading?: boolean }[]) => lines.filter((l) => !l.heading).map((l) => [l.id, formatCents(l.cents)]);

  // A group's heading (Expenses, What-if rows switched on)
  // has no figure, so it is not a statement line.
  test("opens on Monthly: each statement shows the ladder's monthly lines, to the cent", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Monthly" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Yearly" }).getAttribute("aria-pressed")).toBe("false");
    expect(lineTexts("statement-to-live")).toEqual(expected(ladder.statements!.toLive.monthly));
    expect(lineTexts("statement-to-live-and-goals")).toEqual(expected(ladder.statements!.toLiveAndHitGoals.monthly));
  });

  test("Yearly flips every line of both statements, and the choice is remembered on this computer", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Yearly" }));
    expect(lineTexts("statement-to-live")).toEqual(expected(ladder.statements!.toLive.yearly));
    expect(lineTexts("statement-to-live-and-goals")).toEqual(expected(ladder.statements!.toLiveAndHitGoals.yearly));
    expect(window.localStorage.getItem(LADDER_VIEW_KEY)).toBe("yearly");
    cleanup();
    renderPanel();
    expect(screen.getByRole("button", { name: "Yearly" }).getAttribute("aria-pressed")).toBe("true");
    expect(lineTexts("statement-to-live")).toEqual(expected(ladder.statements!.toLive.yearly));
  });

  // Take-home is after giving; Expenses list the
  // budget's lines without Charity; each row switched on is its own line, goal savings too.
  test("names the lines in plain words, money out with a minus, each goal saving on its own line", () => {
    renderPanel();
    const labels = [...screen.getByTestId("statement-to-live-and-goals").querySelectorAll("[data-testid='statement-label']")].map((el) => el.textContent);
    expect(labels).toEqual([
      "Gross pay",
      "Federal income tax (estimated)",
      "Social Security and Medicare (estimated)",
      "Benefits (estimated)",
      expect.stringMatching(/^Charity \(/),
      "= Take-home",
      "Expenses",
      "Rent",
      "Groceries",
      "What-if rows switched on",
      "New car",
      "Groceries",
      "Saving for Second vehicle",
      "Saving for House",
      "Expenses and what-if rows, in all",
      expect.stringMatching(/^= (Left over|Short)$/),
    ]);
    const federal = screen.getByTestId("statement-to-live").querySelector("[data-line='federal'] [data-testid='statement-value']")!;
    expect(federal.textContent).toMatch(/^-\$/);
  });

  test("the salary each step needs stays one click away under each statement, and flips with the view", () => {
    renderPanel();
    expect(screen.queryAllByTestId("ladder-rung")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Show the salary each step needs (3)" }));
    const rows = screen.getAllByTestId("ladder-rung");
    expect(rows.map((r) => r.getAttribute("data-rung-id"))).toEqual(["start", "car", "uber"]);
    expect(rows[1].textContent).toContain(`+${formatCents(70_000)} a month`);
    fireEvent.click(screen.getByRole("button", { name: "Yearly" }));
    expect(screen.getAllByTestId("ladder-rung")[1].textContent).toContain(`+${formatCents(840_000)} a year`);
    fireEvent.click(screen.getByRole("button", { name: "Show the salary each goal saving needs (2)" }));
    expect(screen.getAllByTestId("ladder-rung").map((r) => r.getAttribute("data-rung-id"))).toEqual(["start", "car", "uber", "car2", "house"]);
  });

  test("red only for a real shortfall: Salary to live's few cents of rounding are not red", () => {
    renderPanel();
    const left = screen.getByTestId("statement-to-live").querySelector("[data-line='left-over'] [data-testid='statement-value']")!;
    expect(left.className).not.toMatch(/text-destructive/);
  });

  test("an additional W-2 salary is its own line and a note says the tax lines cover both", () => {
    const withOther = whatIfLadder({ ...w, additionalSalary: { kind: "w2", grossAnnualCents: 6_000_000, fromPeriod: "2026-11" } }, lines, goals, "2026-10", a);
    renderPanel({ ladder: withOther });
    expect(screen.getByTestId("statement-to-live").querySelector("[data-line='other-gross'] [data-testid='statement-value']")!.textContent).toBe(formatCents(500_000));
    expect(screen.getAllByTestId("statement-note").map((n) => n.textContent).join(" ")).toMatch(/taxed together/);
  });
});
