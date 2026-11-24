// tests/domain/forecast-rounding.test.ts
// The pot is 5% of pay into the bank (after tax and benefits); figures below worked by hand.
//
// The Forecast worked a month's
// bank income and maaser from the unrounded breakdown, while the income statement and Check a
// salary go through the rounded breakdown and monthlyPayCents (the app's one rounding path,
// one rounding path). Now the Forecast takes the same path, so for any salary its month equals the
// statement's to the cent. The current salary keeps its firm tax figures; a what-if's own
// salary keeps estimated taxes; an additional W-2 salary is taxed jointly.
//
// The worked case: $90,050 a year, the demo household's salary (benefits $340.00 a month
// before tax, the pot 5%, one child, married filing jointly), no additional salary.
//   Benefits a year: $340.00 x 12 = $4,080.00. Wages: $90,050.00 - $4,080.00 = $85,970.00.
//   Social Security and Medicare: 7.65% x $85,970.00 = $6,576.705 (unrounded).
//   Taxable: $85,970.00 - $32,200.00 standard deduction = $53,770.00.
//   Federal: 10% x $24,800.00 = $2,480.00; 12% x ($53,770.00 - $24,800.00 = $28,970.00) = $3,476.40;
//            $5,956.40 less the $2,200.00 child credit = $3,756.40.
//   After tax: $90,050.00 - $6,576.705 - $3,756.40 = $79,716.895 unrounded; rounded $79,716.90.
//   A month in the bank, the statement's way: ($79,716.90 - $4,080.00) / 12 = $75,636.90 / 12
//            = $6,303.075, rounds to $6,303.08. (Unrounded: $75,636.895 / 12 = $6,303.0746,
//            $6,303.07: the Forecast's old cent.)
//   The pot, 5% of what lands in the bank: 5% x $75,636.90 / 12 = $3,781.845 / 12 = $315.154,
//            rounds to $315.15.
//   Left after the pot: $6,303.08 - $315.15 = $5,987.93.
import { describe, expect, test } from "vitest";
import { cashForecast } from "../../src/domain/cash-forecast";
import { incomeStatement, statementCents } from "../../src/domain/income-statement";
import { demoSalary } from "../demo";
import { currentSalaryBreakdown, spendableAtSalary, w2Breakdown, type SalaryAssumptions, type SalaryBreakdown } from "../../src/domain/salary";
import type { WhatIf } from "../../src/domain/what-if";

const FROM = "2026-11";
const AS_OF = "2026-10-15"; // the Forecast's first month is 2026-11
const gross = (cents: number) => ({ kind: "gross" as const, grossAnnualCents: cents, fromPeriod: FROM });

/** The Forecast's first month with no budget: money in, and the Charity line raised to maaser. */
function forecastMonth(a: SalaryAssumptions, whatIf: WhatIf | null = null) {
  const m = cashForecast({ budgetLines: [], asOfDate: AS_OF, assumptions: a, whatIf })[0];
  return { bankCents: m.incomeCents, maaserCents: m.costCents };
}

/** The statement's month: the paycheck (take-home plus maaser) and the maaser. */
function statementMonth(b: SalaryBreakdown, a: SalaryAssumptions) {
  const s = incomeStatement({ breakdown: b, assumptions: a, charityLineMonthlyCents: 0, expenses: [] });
  const maaser = -statementCents(s.monthly, "maaser");
  return { bankCents: statementCents(s.monthly, "take-home") + maaser, maaserCents: maaser };
}

const FIRM_120: SalaryAssumptions = {
  premiumMonthlyCents: 50_000,
  premiumFromSettings: true,
  maaserRate: 0.1,
  children: 1,
  currentSalary: gross(12_000_000),
  firmTaxes: { federalAnnualCents: 800_000, payrollAnnualCents: 900_000 },
};
// A paycheck-settings fixture: $150,000, every two weeks, with round yearly tax figures and a round premium.

const PAYCHECK_150: SalaryAssumptions = {
  premiumMonthlyCents: 66_000,
  premiumFromSettings: true,
  maaserRate: 0.1,
  children: 1,
  currentSalary: gross(15_000_000),
  firmTaxes: { federalAnnualCents: 2_100_000, payrollAnnualCents: 1_600_000 },
};

const CURRENT_CASES: [string, SalaryAssumptions][] = [
  ["$90,050, the demo salary (the worked case)", { ...demoSalary(), currentSalary: gross(9_005_000) }],
  ["$100,010 and a $2,000.00 additional monthly amount", { ...demoSalary(), currentSalary: gross(10_001_000), additionalSalary: { kind: "monthly", monthlyCents: 200_000, fromPeriod: FROM } }],
  ["$90,000, estimated, two children", { ...demoSalary(), children: 2, currentSalary: gross(9_000_000) }],
  ["$120,000 with firm taxes", FIRM_120],
  ["$150,000 with firm taxes from paycheck figures", PAYCHECK_150],
  ["$150,000 with firm taxes and a $60,000 W-2 additional salary, taxed jointly", { ...PAYCHECK_150, additionalSalary: { kind: "w2", grossAnnualCents: 6_000_000, fromPeriod: FROM } }],
  ["$275,000 with firm federal tax only, over the Social Security wage base", { ...FIRM_120, currentSalary: gross(27_500_000), firmTaxes: { federalAnnualCents: 5_000_000, payrollAnnualCents: null } }],
];

describe("the Forecast's month is the statement's month, to the cent", () => {
  test("the worked case by hand: $6,303.08 in the bank, $315.15 to the pot, $5,987.93 left", () => {
    const a = CURRENT_CASES[0][1];
    expect(forecastMonth(a)).toEqual({ bankCents: 630_308, maaserCents: 31_515 });
    expect(statementMonth(currentSalaryBreakdown(9_005_000, 0, a), a)).toEqual({ bankCents: 630_308, maaserCents: 31_515 });
    expect(spendableAtSalary(9_005_000, 0, a, undefined, { current: true }).spendableMonthlyCents).toBe(598_793);
  });

  test.each(CURRENT_CASES)("the current salary: %s", (_name, a) => {
    const g = (a.currentSalary as { grossAnnualCents: number }).grossAnnualCents;
    const f = forecastMonth(a);
    // The statement, and Check a salary on the current salary.
    expect(f).toEqual(statementMonth(currentSalaryBreakdown(g, 0, a), a));
    expect(f.bankCents - f.maaserCents).toBe(spendableAtSalary(g, 0, a, undefined, { current: true }).spendableMonthlyCents);
  });

  test.each([10_001_000, 9_000_000, 13_000_000])("a what-if's own salary of %i cents keeps estimated taxes, the statement's way", (whatIfGross) => {
    const w: WhatIf = { scenarioId: "w", salaryGrossAnnualCents: whatIfGross, salaryFromPeriod: FROM, changes: [], rows: [] };
    const f = forecastMonth(FIRM_120, w);
    expect(f).toEqual(statementMonth(w2Breakdown(whatIfGross, 0, FIRM_120), FIRM_120));
    expect(f.bankCents - f.maaserCents).toBe(spendableAtSalary(whatIfGross, 0, FIRM_120).spendableMonthlyCents);
  });
});
