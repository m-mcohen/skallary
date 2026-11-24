// tests/ui/summary-bridge.test.ts
//
// Top bar summary:
//   The top bar's take-home panel carries one bridge line, "Monthly
//     budget $X, less the Charity line $Y (giving covers it), equals Take-home needed $Z",
//     built from the same figures as the bar, so the two cannot drift.
//   The bar's Salary needed says "with goals" whenever a goal saving
//     row is switched on under the active what-if.
//   Take-home needed keeps meaning take-home after giving: what the expenses and
//     what-if rows need, the statement's "in all".
//   Salary needed prices a usual month, so the bridge no
//     longer names next month's one-month amounts (they used to add $300.00 here).
import { describe, expect, test } from "vitest";
import { summariseForMasthead, type MastheadSummaryInput } from "../../src/ui/lib/instrument";
import { statementCents, takeHomeBridge } from "../../src/domain/income-statement";
import type { SalaryAssumptions } from "../../src/domain/salary";
import type { BudgetLine, Goal } from "../../src/domain/plan-types";
import type { Scenario } from "../../src/domain/scenario";
import type { WhatIf } from "../../src/domain/what-if";

const a: SalaryAssumptions = { premiumMonthlyCents: 60_000, premiumFromSettings: true, maaserRate: 0.1, children: 1 };
const LINES: BudgetLine[] = [
  { planId: "p", planningCategory: "Rent", period: null, amountCents: 200_000 },
  { planId: "p", planningCategory: "Groceries", period: null, amountCents: 90_000 },
  { planId: "p", planningCategory: "Charity", period: null, amountCents: 50_000 },
  // A one-month amount next month: Monthly budget and Salary needed both read the usual
  // $900.00; the $1,200.00 reaches the Forecast only (item c).
  { planId: "p", planningCategory: "Groceries", period: "2026-11", amountCents: 120_000 },
];
const base: MastheadSummaryInput = { accounts: [], balances: [], budgetLines: LINES, categorySettings: [], uncategorizedCount: 0, ruleCount: 0, lastSyncedAt: null, asOfDate: "2026-10-15", salaryAssumptions: a };
const scenario: Scenario = { id: "s1", planId: "p", name: "Offer A", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "2026-10-15" };
const goal: Goal = { id: "g1", name: "Trip", goalType: "savings", targetAmountCents: 1_200_000, targetDate: "2027-10-01", priority: 1, currentAmountCents: 0, plannedMonthlyCents: 100_000, notes: "", archivedAt: null };
const car = { id: "car", position: 1, kind: "add" as const, label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2026-11", untilPeriod: null, loan: null };
const whatIf = (rows: WhatIf["rows"], over: Partial<WhatIf> = {}): WhatIf => ({ scenarioId: "s1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [car], rows, ...over });

describe("the bridge line", () => {
  test("one function: Monthly budget less the Charity line, plus any goal savings, is Take-home needed", () => {
    expect(takeHomeBridge(700_000, 50_000, 0)).toEqual({ monthlyBudgetCents: 700_000, charityLineCents: 50_000, goalSavingCents: 0, takeHomeNeededCents: 650_000 });
  });

  test("Real numbers: built from the bar's own Monthly budget, equal to the statement's expenses in all", () => {
    const m = summariseForMasthead(base);
    // Rent 2,000.00 + Groceries 900.00 + Charity 500.00 = 3,400.00 (the one-month Groceries amount is not every month)
    expect(m.reading.burnCents).toBe(340_000);
    const bridge = m.salary!.bridge;
    // 3,400.00 - 500.00 = 2,900.00 (the one-month Groceries amount moves nothing here)
    expect(bridge).toEqual({ monthlyBudgetCents: 340_000, charityLineCents: 50_000, goalSavingCents: 0, takeHomeNeededCents: 290_000 });
    expect(bridge.takeHomeNeededCents).toBe(-statementCents(m.salary!.statement.monthly, "in-all"));
  });

  test("under a what-if with a goal saving on: the same figures as the bar and the ladder's second statement", () => {
    const m = summariseForMasthead({ ...base, scenario, whatIf: whatIf([{ kind: "change", refId: "car", position: 1, on: true }, { kind: "goal-saving", refId: "g1", position: 2, on: true }]), goals: [goal] });
    // 3,400.00 + New car 700.00 = 4,100.00; less 500.00 = 3,600.00; plus 1,000.00 saving = 4,600.00
    expect(m.reading.burnCents).toBe(410_000);
    expect(m.salary!.bridge).toEqual({ monthlyBudgetCents: 410_000, charityLineCents: 50_000, goalSavingCents: 100_000, takeHomeNeededCents: 460_000 });
    expect(m.salary!.bridge.takeHomeNeededCents).toBe(-statementCents(m.salary!.statement.monthly, "in-all"));
  });

  test("a what-if's own salary raises the Charity line to its giving amount: the bridge takes the raised line, and still ties out", () => {
    const m = summariseForMasthead({ ...base, scenario, whatIf: whatIf([{ kind: "change", refId: "car", position: 1, on: true }], { salaryGrossAnnualCents: 20_000_000, salaryFromPeriod: "2026-11" }) });
    const b = m.salary!.bridge;
    expect(b.charityLineCents).toBeGreaterThan(50_000);
    expect(b.monthlyBudgetCents).toBe(m.reading.burnCents);
    expect(b.takeHomeNeededCents).toBe(m.reading.burnCents - b.charityLineCents);
    expect(b.takeHomeNeededCents).toBe(-statementCents(m.salary!.statement.monthly, "in-all"));
  });
});

describe("with goals", () => {
  test("off with Real numbers, and under a what-if with no goal saving on", () => {
    expect(summariseForMasthead(base).salary!.withGoals).toBe(false);
    const m = summariseForMasthead({ ...base, scenario, whatIf: whatIf([{ kind: "change", refId: "car", position: 1, on: true }, { kind: "goal-saving", refId: "g1", position: 2, on: false }]), goals: [goal] });
    expect(m.salary!.withGoals).toBe(false);
  });

  test("on whenever a goal saving row is switched on under the active what-if", () => {
    const m = summariseForMasthead({ ...base, scenario, whatIf: whatIf([{ kind: "goal-saving", refId: "g1", position: 1, on: true }]), goals: [goal] });
    expect(m.salary!.withGoals).toBe(true);
  });
});
