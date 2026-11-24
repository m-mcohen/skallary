// tests/domain/your-income-statement.test.ts
// The ladder's "Your income" statement: the real salary, not a
// salary solved to break even, so Left over is a true number. Gross pay less tax,
// benefits and maaser is Take-home; Take-home less expenses and every row switched on
// is Left over. It must agree with the verdict, which prices the same salary.
import { describe, expect, test } from "vitest";
import { salaryVerdict, whatIfLadder, type WhatIf, type WhatIfChange } from "../../src/domain/what-if";
import { DEFAULT_SALARY_ASSUMPTIONS, currentSalaryBreakdown, w2Breakdown, type SalaryAssumptions } from "../../src/domain/salary";
import { statementCents } from "../../src/domain/income-statement";
import type { BudgetLine } from "../../src/domain/plan-types";

const base: BudgetLine[] = [
  { planId: "p", planningCategory: "Rent", period: null, amountCents: 210_000 },
  { planId: "p", planningCategory: "Groceries", period: null, amountCents: 65_000 },
  { planId: "p", planningCategory: "Charity", period: null, amountCents: 15_000 },
];
const current: SalaryAssumptions = {
  ...DEFAULT_SALARY_ASSUMPTIONS,
  premiumFromSettings: true,
  currentSalary: { kind: "gross", grossAnnualCents: 9_600_000, fromPeriod: "2026-11" },
};
const empty: WhatIf = { scenarioId: "w", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };
const car: WhatIfChange = { id: "car", position: 1, kind: "add", label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2026-11", untilPeriod: null, loan: null };

describe("Your income statement", () => {
  test("starts from the current salary, not a salary solved to break even", () => {
    const l = whatIfLadder(empty, base, [], "2026-11", current);
    const s = l.statements!.yourIncome!;
    expect(s.grossAnnualCents).toBe(9_600_000);
    expect(s.whose).toBe("current");
    expect(statementCents(s.statement.yearly, "gross")).toBe(9_600_000);
    const b = currentSalaryBreakdown(9_600_000, 15_000 * 12, current);
    expect(statementCents(s.statement.yearly, "take-home")).toBe(b.takeHomeAnnualCents);
    // Left over is real: well above zero at $96,000 against $2,750.00 of costs.
    expect(statementCents(s.statement.monthly, "left-over")).toBeGreaterThan(300_000);
  });

  test("Take-home less expenses less every row switched on is Left over, each view to the cent", () => {
    const l = whatIfLadder({ ...empty, changes: [car] }, base, [], "2026-11", current);
    const s = l.statements!.yourIncome!.statement;
    for (const view of ["monthly", "yearly"] as const) {
      const k = view === "yearly" ? 12 : 1;
      const takeHome = statementCents(s[view], "take-home");
      expect(statementCents(s[view], "row:car")).toBe(-70_000 * k);
      expect(statementCents(s[view], "in-all")).toBe(-(210_000 + 65_000 + 70_000) * k);
      expect(statementCents(s[view], "left-over")).toBe(takeHome + statementCents(s[view], "in-all"));
    }
  });

  test("a switched-off row is left out", () => {
    const l = whatIfLadder({ ...empty, changes: [car], rows: [{ kind: "change", refId: "car", position: 1, on: false }] }, base, [], "2026-11", current);
    expect(statementCents(l.statements!.yourIncome!.statement.monthly, "row:car")).toBe(0);
  });

  test("a what-if's own salary is the one counted, estimated", () => {
    const l = whatIfLadder({ ...empty, salaryGrossAnnualCents: 7_200_000 }, base, [], "2026-11", current);
    const s = l.statements!.yourIncome!;
    expect(s.grossAnnualCents).toBe(7_200_000);
    expect(s.whose).toBe("own");
    expect(statementCents(s.statement.yearly, "take-home")).toBe(w2Breakdown(7_200_000, 15_000 * 12, current).takeHomeAnnualCents);
  });

  test("firm tax figures apply to the current salary", () => {
    const firm = { ...current, firmTaxes: { federalAnnualCents: 700_000, payrollAnnualCents: null } };
    const l = whatIfLadder(empty, base, [], "2026-11", firm);
    expect(statementCents(l.statements!.yourIncome!.statement.yearly, "federal")).toBe(-700_000);
  });

  test("no yearly salary: no statement", () => {
    expect(whatIfLadder(empty, base, [], "2026-11", { ...current, currentSalary: null }).statements!.yourIncome).toBeNull();
    const takeHome = { ...current, currentSalary: { kind: "take-home" as const, monthlyCents: 600_000, fromPeriod: "2026-11" } };
    expect(whatIfLadder(empty, base, [], "2026-11", takeHome).statements!.yourIncome).toBeNull();
  });

  test("agrees with the verdict's Left over when everything is covered", () => {
    const w = { ...empty, changes: [car] };
    const l = whatIfLadder(w, base, [], "2026-11", current);
    const v = salaryVerdict(l, 9_600_000, current, { whatIf: w, baseLines: base, currentSalary: true });
    expect(v.covered).toBe(true);
    // The verdict rounds to whole dollars in its words; the figures agree within a cent.
    expect(Math.abs(statementCents(l.statements!.yourIncome!.statement.monthly, "left-over") - v.leftOverMonthlyCents)).toBeLessThanOrEqual(1);
  });
});
