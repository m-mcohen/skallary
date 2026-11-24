// tests/domain/usual-month.test.ts
//
// Salary needed and Take-home needed price a USUAL month: each budget line's every-month amount. A one-month budget amount
// (a single month's Budget cell) never moves them, nor the ladder, its income statements,
// Check a salary or the verdict. One-offs belong in a One-time cost row and the Forecast.
// So Monthly budget less the Charity line (plus goal savings switched on) always equals
// Take-home needed, and the bridge line names nothing else. The Forecast keeps each
// month's real plan, one-month amounts included.
//
// The figures, by hand (as of 2026-10-02, so next month is 2026-11):
//   Rent $2,100.00, Groceries $650.00, Charity $150.00 every month.
//   One-month amounts in Nov 2026: Groceries $1,000.00, Charity $300.00.
//   Monthly budget = 2,100.00 + 650.00 + 150.00 = $2,900.00
//   Take-home needed = 2,900.00 - 150.00 = $2,750.00 = Rent + Groceries, the statement's in all.
//   Under the what-if (New car $700.00, a $1,000.00 goal saving switched on):
//     Monthly budget 2,900.00 + 700.00 = $3,600.00; less 150.00 = 3,450.00; plus 1,000.00 = $4,450.00.
//   Under a what-if that changes Groceries to $900.00:
//     Monthly budget 2,900.00 + (900.00 - 650.00 = 250.00) = $3,150.00; less 150.00 = $3,000.00.
import { describe, expect, test } from "vitest";
import { usualMonthLines } from "../../src/domain/budget";
import { statementCents, takeHomeBridge } from "../../src/domain/income-statement";
import { cashForecast } from "../../src/domain/cash-forecast";
import { checkSalary, normalMonthCents, salaryVerdict, whatIfLadder, type WhatIf, type WhatIfChange } from "../../src/domain/what-if";
import { summariseForMasthead, type MastheadSummaryInput } from "../../src/ui/lib/instrument";
import type { SalaryAssumptions } from "../../src/domain/salary";
import type { BudgetLine, Goal } from "../../src/domain/plan-types";
import type { Scenario } from "../../src/domain/scenario";

const a: SalaryAssumptions = { premiumMonthlyCents: 45_000, premiumFromSettings: true, maaserRate: 0.1, children: 1 };
const USUAL: BudgetLine[] = [
  { planId: "p", planningCategory: "Rent", period: null, amountCents: 210_000 },
  { planId: "p", planningCategory: "Groceries", period: null, amountCents: 65_000 },
  { planId: "p", planningCategory: "Charity", period: null, amountCents: 15_000 },
];
const ONE_MONTH: BudgetLine[] = [
  { planId: "p", planningCategory: "Groceries", period: "2026-11", amountCents: 100_000 },
  { planId: "p", planningCategory: "Charity", period: "2026-11", amountCents: 30_000 },
];
const WITH = [...USUAL, ...ONE_MONTH];

const base = (budgetLines: BudgetLine[]): MastheadSummaryInput => ({
  accounts: [], balances: [], budgetLines, categorySettings: [], uncategorizedCount: 0, ruleCount: 0, lastSyncedAt: null, asOfDate: "2026-10-02", salaryAssumptions: a,
});
const scenario: Scenario = { id: "s1", planId: "p", name: "New job", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "2026-10-02" };
const goal: Goal = { id: "g1", name: "Trip", goalType: "savings", targetAmountCents: 1_200_000, targetDate: "2027-10-01", priority: 1, currentAmountCents: 0, plannedMonthlyCents: 100_000, notes: "", archivedAt: null };
const car: WhatIfChange = { id: "car", position: 1, kind: "add", label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2026-11", untilPeriod: null, loan: null };
const groceries: WhatIfChange = { id: "gro", position: 2, kind: "change", label: "Groceries", planningCategory: "Groceries", amountCents: 90_000, fromPeriod: "2026-11", untilPeriod: null, loan: null };
const groceriesCut: WhatIfChange = { id: "cut", position: 3, kind: "cut", label: "Groceries cut", planningCategory: "Groceries", amountCents: 50_000, fromPeriod: "2026-11", untilPeriod: null, loan: null };
const whatIf = (changes: WhatIfChange[], rows: WhatIf["rows"]): WhatIf => ({ scenarioId: "s1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes, rows });

/** Everything the salary side of the top bar shows. */
const salarySide = (budgetLines: BudgetLine[], over: Partial<MastheadSummaryInput> = {}) => {
  const m = summariseForMasthead({ ...base(budgetLines), ...over });
  return { burn: m.reading.burnCents, salary: m.salary };
};

describe("the usual month is defined once", () => {
  test("usualMonthLines keeps each line's every-month amount and drops every one-month amount", () => {
    expect(usualMonthLines(WITH, "2026-11")).toEqual(USUAL);
    // An every-month row spelled period "" comes back as period null.
    expect(usualMonthLines([{ planId: "p", planningCategory: "Rent", period: "", amountCents: 1 }, ...ONE_MONTH], "2026-11")).toEqual([{ planId: "p", planningCategory: "Rent", period: null, amountCents: 1 }]);
  });
});

describe("Real numbers: one-month amounts next month never move the salary side", () => {
  test("Salary needed, Take-home needed, the statement and the bridge are the same as with no one-month amounts", () => {
    expect(salarySide(WITH)).toEqual(salarySide(USUAL));
  });

  test("Monthly budget less the Charity line is Take-home needed, to the cent, and is the statement's in all", () => {
    const { burn, salary } = salarySide(WITH);
    // 2,100.00 + 650.00 + 150.00 = 2,900.00; less 150.00 = 2,750.00
    expect(burn).toBe(290_000);
    expect(salary!.bridge).toEqual({ monthlyBudgetCents: 290_000, charityLineCents: 15_000, goalSavingCents: 0, takeHomeNeededCents: 275_000 });
    expect(salary!.bridge.takeHomeNeededCents).toBe(salary!.bridge.monthlyBudgetCents - salary!.bridge.charityLineCents);
    expect(-statementCents(salary!.statement.monthly, "in-all")).toBe(275_000);
    // The statement's Groceries line is the usual $650.00, not November's $1,000.00.
    expect(statementCents(salary!.statement.monthly, "expense:Groceries")).toBe(-65_000);
  });

  test("the bridge line names no one-month amounts", () => {
    const { salary } = salarySide(WITH);
    expect(Object.keys(takeHomeBridge(1, 1, 0)).sort()).toEqual(["charityLineCents", "goalSavingCents", "monthlyBudgetCents", "takeHomeNeededCents"]);
  });
});

describe("under a what-if: the ladder, its statements, Check a salary and the verdict price the usual month", () => {
  const w = whatIf([car], [{ kind: "change", refId: "car", position: 1, on: true }, { kind: "goal-saving", refId: "g1", position: 2, on: true }]);
  const goals = [{ id: "g1", name: "Trip", recommendedMonthlyCents: 100_000, complete: false, plannedCostCents: 0 }];

  test("the ladder is the same with or without next month's one-month amounts", () => {
    expect(whatIfLadder(w, WITH, goals, "2026-11", a)).toEqual(whatIfLadder(w, USUAL, goals, "2026-11", a));
  });

  test("the top bar: unchanged, and Monthly budget less Charity plus goal savings is Take-home needed and the in all", () => {
    const over = { scenario, whatIf: w, goals: [goal] };
    expect(salarySide(WITH, over)).toEqual(salarySide(USUAL, over));
    const { burn, salary } = salarySide(WITH, over);
    // 2,900.00 + 700.00 = 3,600.00; less 150.00 = 3,450.00; plus 1,000.00 = 4,450.00
    expect(burn).toBe(360_000);
    expect(salary!.bridge).toEqual({ monthlyBudgetCents: 360_000, charityLineCents: 15_000, goalSavingCents: 100_000, takeHomeNeededCents: 445_000 });
    expect(-statementCents(salary!.statement.monthly, "in-all")).toBe(445_000);
  });

  test("a change to a line with a one-month amount moves Monthly budget from the usual amount", () => {
    const over = { scenario, whatIf: whatIf([groceries], [{ kind: "change", refId: "gro", position: 1, on: true }]) };
    const { burn, salary } = salarySide(WITH, over);
    // 2,900.00 + (900.00 - 650.00 = 250.00) = 3,150.00; less 150.00 = 3,000.00
    expect(burn).toBe(315_000);
    expect(salary!.bridge.takeHomeNeededCents).toBe(300_000);
    expect(-statementCents(salary!.statement.monthly, "in-all")).toBe(300_000);
    expect(salarySide(WITH, over)).toEqual(salarySide(USUAL, over));
  });

  test("Check a salary and the verdict are the same with or without one-month amounts, a cut included", () => {
    const wc = whatIf([car, groceriesCut], [{ kind: "change", refId: "car", position: 1, on: true }, { kind: "change", refId: "cut", position: 2, on: true }]);
    const at = (lines: BudgetLine[]) => {
      const ladder = whatIfLadder(wc, lines, [], "2026-11", a);
      const ctx = { whatIf: wc, baseLines: lines };
      return { check: checkSalary(ladder, 9_000_000, a, ctx), verdict: salaryVerdict(ladder, 9_000_000, a, ctx) };
    };
    expect(at(WITH)).toEqual(at(USUAL));
    // The cut is measured from the usual $650.00: $500.00 is $150.00 less.
    expect(whatIfLadder(wc, WITH, [], "2026-11", a).rungs.find((r) => r.id === "cut")!.monthlyCents).toBe(-15_000);
  });
});

describe("the Forecast keeps each month's real plan", () => {
  test("November counts its one-month amounts; December the usual ones", () => {
    const months = cashForecast({ budgetLines: WITH, asOfDate: "2026-10-02", assumptions: a });
    // Nov: 2,100.00 + 1,000.00 + 300.00 = 3,400.00; Dec: 2,100.00 + 650.00 + 150.00 = 2,900.00
    expect(months.find((m) => m.period === "2026-11")!.costCents).toBe(340_000);
    expect(months.find((m) => m.period === "2026-12")!.costCents).toBe(290_000);
  });
});

// A planned big month never counts in Monthly budget. Big months are
// never budget rows (they travel beside the lines), so the usual month of a December that has one
// is still the every-month total.
test("Monthly budget never sees a big month", () => {
  const lines: BudgetLine[] = [{ planId: "p", planningCategory: "Gifts", period: null, amountCents: 10000 }];
  expect(normalMonthCents(lines, "2026-12")).toBe(10000);
});
