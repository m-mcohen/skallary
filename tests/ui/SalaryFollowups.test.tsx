// @vitest-environment jsdom
// tests/ui/SalaryFollowups.test.tsx
//
// The charity amount is a tenth of pay into the bank (after tax and benefits); figures below re-worked by hand.
//
// On the screens:
//   The What if ladder reads Gross pay; the taxes, premium and the charity amount; = Take-home;
//     Expenses (no Charity, with a note); the what-if rows; in all; Left over or short.
//     Monthly | Yearly flips every line. "Take-home pay" is gone.
//   Settings, Salary takes firm taxes for the current salary and a premium
//     that can be cleared back to the estimate; lines say estimated or from Settings.
//     (Both are typed a paycheck, with a pay schedule.)
//   The top bar's take-home panel ends with the bridge line.
//   The top bar's Salary needed says "with goals" when a goal saving is on.
import { afterEach, describe, expect, test, vi, beforeEach } from "vitest";
import { NEEDED_OPEN_KEY } from "../../src/ui/what-if/LadderPanel";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LadderPanel from "../../src/ui/what-if/LadderPanel";
import CurrentSalaryCard from "../../src/ui/CurrentSalaryCard";
import CheckSalaryBox from "../../src/ui/what-if/CheckSalaryBox";
import { whatIfLadder, type LadderGoal, type WhatIf } from "../../src/domain/what-if";
import { summariseForMasthead, type InstrumentReading } from "../../src/ui/lib/instrument";
import { DEFAULT_SALARY_ASSUMPTIONS, type SalaryAssumptions } from "../../src/domain/salary";
import { formatCents } from "../../src/domain/money";
import type { BudgetLine } from "../../src/domain/plan-types";
import type { Scenario } from "../../src/domain/scenario";
import type { Db } from "../../src/ui/lib/db";
import type { IncomeSettings } from "../../src/domain/income";

// These tests read the two break-even statements, which sit in
// "Salary you would need", collapsed at first: open it before each test.
beforeEach(() => window.localStorage.setItem(NEEDED_OPEN_KEY, "true"));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const a: SalaryAssumptions = { ...DEFAULT_SALARY_ASSUMPTIONS, premiumMonthlyCents: 60_000, premiumFromSettings: true, maaserRate: 0.1, children: 1 };
const lines: BudgetLine[] = [
  { planId: "p", planningCategory: "Rent", period: null, amountCents: 250_000 },
  { planId: "p", planningCategory: "Groceries", period: null, amountCents: 90_000 },
  { planId: "p", planningCategory: "Charity", period: null, amountCents: 50_000 },
];
const goals: LadderGoal[] = [{ id: "house", name: "House", recommendedMonthlyCents: 450_000, complete: false, plannedCostCents: 0 }];
const w: WhatIf = {
  scenarioId: "w1",
  salaryGrossAnnualCents: null,
  salaryFromPeriod: null,
  changes: [{ id: "car", position: 1, kind: "add", label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2026-11", untilPeriod: null, loan: null }],
  rows: [
    { kind: "change", refId: "car", position: 1, on: true },
    { kind: "goal-saving", refId: "house", position: 2, on: true },
  ],
};
const ladder = whatIfLadder(w, lines, goals, "2026-11", a);
const labels = (testId: string) => [...screen.getByTestId(testId).querySelectorAll("[data-testid='statement-label']")].map((el) => el.textContent);
const value = (testId: string, line: string) => screen.getByTestId(testId).querySelector(`[data-line='${line}'] [data-testid='statement-value']`)?.textContent;

describe("the ladder in list order", () => {
  test("pay, what comes out, Take-home, Expenses without Charity, the what-if rows, in all, left over", () => {
    render(<LadderPanel ladder={ladder} />);
    expect(labels("statement-to-live-and-goals")).toEqual([
      "Gross pay",
      "Federal income tax (estimated)",
      "Social Security and Medicare (estimated)",
      "Benefits (from Settings)",
      "Charity (its share of pay into the bank)",
      "= Take-home",
      "Expenses",
      "Rent",
      "Groceries",
      "What-if rows switched on",
      "New car",
      "Saving for House",
      "Expenses and what-if rows, in all",
      expect.stringMatching(/^= (Left over|Short)$/),
    ]);
    expect(screen.getByTestId("ladder-panel-root").textContent).not.toMatch(/Take-home pay|Left for the budget/);
    expect(screen.getAllByTestId("statement-note").map((n) => n.textContent).join(" ")).toMatch(/The Charity line is left out of Expenses: the line above Take-home covers it\./);
    expect(value("statement-to-live-and-goals", "expense:Charity")).toBeUndefined();
  });

  test("Monthly | Yearly flips every line: Rent $2,500.00 a month, $30,000.00 a year", () => {
    render(<LadderPanel ladder={ladder} />);
    expect(value("statement-to-live", "expense:Rent")).toBe(formatCents(-250_000));
    expect(value("statement-to-live", "row:car")).toBe(formatCents(-70_000));
    fireEvent.click(screen.getByRole("button", { name: "Yearly" }));
    expect(value("statement-to-live", "expense:Rent")).toBe(formatCents(-3_000_000));
    expect(value("statement-to-live", "row:car")).toBe(formatCents(-840_000));
    for (const l of ladder.statements!.toLive.yearly) if (!l.heading) expect(value("statement-to-live", l.id)).toBe(formatCents(l.cents));
  });
});

// Items 6 and 7 (the old top bar's Take-home needed and its bridge line) left with the bar;
// the bridge figures stay pinned in tests/ui/summary-bridge.test.ts and tests/domain/usual-month.test.ts.


describe("Settings, Salary", () => {
  const BASE: SalaryAssumptions = { premiumMonthlyCents: 50_000, premiumFromSettings: true, maaserRate: 0.1, children: 1 };
  const current = { kind: "gross" as const, grossAnnualCents: 12_000_000, fromPeriod: "2026-11" };

  // The yearly tax boxes became paycheck boxes with a
  // pay schedule, and the premium box moved beside them, typed a paycheck. The three tests below
  // pin the same rules (firm figures for the current salary; a blank box is estimated) on the new boxes.
  test("firm taxes for the current salary, typed a paycheck: saved with the salary, and the bank line uses them", async () => {
    const setIncome = vi.fn(async (_db: Db, _i: IncomeSettings) => {});
    const { findByLabelText, findByText, getByText, getByTestId } = render(
      <CurrentSalaryCard dataLayer={{ loadDb: async () => ({}) as Db, getSalarySettings: async () => ({ ...BASE, currentSalary: current }), setIncome }} />
    );
    fireEvent.click(await findByText("Monthly"));
    const federal = (await findByLabelText("Federal income tax, a paycheck")) as HTMLInputElement;
    expect(federal.value).toBe("");
    expect(federal.placeholder).toMatch(/Estimated/);
    fireEvent.change(federal, { target: { value: "666.67" } });
    fireEvent.change(await findByLabelText("Social Security and Medicare, a paycheck"), { target: { value: "750" } });
    // Monthly: federal 666.67 x 12 = 8,000.04 a year; Social Security and Medicare 750 x 12 = 9,000.00.
    // (120,000 - 8,000.04 - 9,000 - 6,000) / 12 = 96,999.96 / 12 = 8,083.33 reaches the bank; the charity amount a tenth of
    // that, 9,699.996 / 12 = 808.33
    await waitFor(() => expect(getByTestId("current-salary-bank").textContent).toMatch(/\$8,083\.33 a month/));
    expect(getByTestId("current-salary-bank").textContent).toMatch(/your firm figures/);
    fireEvent.click(getByText("Save salary"));
    await waitFor(() =>
      expect(setIncome).toHaveBeenCalledWith(expect.anything(), {
        currentSalary: current,
        additionalSalary: null,
        paySchedule: "monthly",
        paycheck: { federalCents: 66_667, payrollCents: 75_000, premiumCents: null },
      })
    );
  });

  test("clearing a figure saves it as estimated again", async () => {
    const setIncome = vi.fn(async (_db: Db, _i: IncomeSettings) => {});
    const stored: SalaryAssumptions = {
      ...BASE,
      currentSalary: current,
      firmTaxes: { federalAnnualCents: 800_004, payrollAnnualCents: 900_000 },
      paySchedule: "monthly",
      paycheck: { federalCents: 66_667, payrollCents: 75_000, premiumCents: null },
    };
    const { findByLabelText, getByText } = render(<CurrentSalaryCard dataLayer={{ loadDb: async () => ({}) as Db, getSalarySettings: async () => stored, setIncome }} />);
    const federal = (await findByLabelText("Federal income tax, a paycheck")) as HTMLInputElement;
    await waitFor(() => expect(federal.value).toBe("666.67"));
    fireEvent.change(federal, { target: { value: "" } });
    fireEvent.click(getByText("Save salary"));
    await waitFor(() =>
      expect(setIncome).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ paycheck: { federalCents: null, payrollCents: 75_000, premiumCents: null } }))
    );
  });

  // The premium is the Benefits list: none typed means none come out of pay (nothing is assumed).
  test("benefits: none typed means none, said under the list; a save sends no list", async () => {
    const stored: SalaryAssumptions = { ...BASE, premiumMonthlyCents: DEFAULT_SALARY_ASSUMPTIONS.premiumMonthlyCents, premiumFromSettings: false };
    const setIncome = vi.fn(async (_db: Db, _i: IncomeSettings) => {});
    const { findByTestId, getByText } = render(<CurrentSalaryCard dataLayer={{ loadDb: async () => ({}) as Db, getSalarySettings: async () => stored, setIncome }} />);
    expect((await findByTestId("benefits-none")).textContent).toBe("None typed: no benefits come out of pay.");
    fireEvent.click(getByText("Save salary"));
    await waitFor(() => expect(setIncome).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ paycheck: { federalCents: null, payrollCents: null, premiumCents: null } })));
    expect(setIncome.mock.calls[0][1]).not.toHaveProperty("benefits");
  });

  test("Check a salary: exactly the current salary uses the firm figures and says so; any other salary is estimated", () => {
    const firm: SalaryAssumptions = { ...BASE, currentSalary: current, firmTaxes: { federalAnnualCents: 800_000, payrollAnnualCents: 900_000 } };
    const living: BudgetLine[] = [{ planId: "p", planningCategory: "Living", period: null, amountCents: 700_000 }];
    const keeps: WhatIf = { scenarioId: "w", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };
    const l = whatIfLadder(keeps, living, [], "2026-11", firm);
    render(<CheckSalaryBox ladder={l} assumptions={firm} initialSalaryCents={12_000_000} currentSalaryCents={12_000_000} context={{ whatIf: keeps, baseLines: living }} />);
    // Firm: (120,000 - 8,000 - 9,000 - 6,000) / 12 = 8,083.33, less the charity amount 97,000 x 10% / 12 = 808.33 -> 7,275.00
    expect(screen.getByText(/Leaves \$7,275\.00 a month to spend/)).toBeTruthy();
    expect(screen.getByTestId("check-tax-source").textContent).toBe("Taxes: your firm figures from Settings, Salary.");
    fireEvent.change(screen.getByLabelText("Salary to check"), { target: { value: "130,000" } });
    expect(screen.getByTestId("check-tax-source").textContent).toBe("Taxes: estimated.");
  });
});
