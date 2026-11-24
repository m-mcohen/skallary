// tests/demo.ts
//
// Small builders tests import instead of typing figures inline. Every value comes from the
// demo household (demo/household.ts), so it is invented. Each call returns fresh copies in
// the app's own domain types, so a test may change what it gets without touching the next.
// The names are a contract other work depends on: keep them.
import { DEMO, generateTransactions, householdOf, type DemoPot } from "../demo/household.js";
import type { Household } from "../src/domain/household.js";
import type { Account, NormalizedTxn } from "../src/domain/types.js";
import type { BudgetLine } from "../src/domain/plan-types.js";
import { DEFAULT_SALARY_ASSUMPTIONS, type SalaryAssumptions } from "../src/domain/salary.js";
import type { CharityPot } from "../src/domain/charity-pot.js";
import { benefitsTotals } from "../src/domain/benefits.js";

/** The household's seven accounts. */
export function demoAccounts(): Account[] {
  return DEMO.accounts.map((a) => structuredClone(a.account));
}

/** The household's names: { youName: "Alex", partnerName: "Sam" }. */
export function demoHousehold(): Household {
  return householdOf(DEMO.people);
}

/** The household's transactions; `months` counts from the first demo month (default: the full year). */
export function demoTransactions(opts?: { months?: number }): NormalizedTxn[] {
  const months = opts?.months;
  return months === undefined ? structuredClone(DEMO.transactions) : generateTransactions(months);
}

/** The every-month lines of the budget year (plan id "demo-2026" in the fixed demo). */
export function demoBudgetLines(): BudgetLine[] {
  return structuredClone(DEMO.budgetLines);
}

/** Settings, Salary as the app reads it for the household. */
export function demoSalary(): SalaryAssumptions {
  const s = DEMO.salary;
  const benefits = structuredClone(s.benefits);
  const totals = benefitsTotals(benefits, s.paySchedule);
  return {
    ...DEFAULT_SALARY_ASSUMPTIONS,
    premiumMonthlyCents: totals.monthlyCents,
    afterTaxBenefitsMonthlyCents: totals.afterTaxMonthlyCents,
    premiumFromSettings: true,
    benefits,
    firmTaxes: null,
    paySchedule: s.paySchedule,
    paycheck: null,
    maaserRate: DEMO.pot.kind === "percent" ? DEMO.pot.amount / 100 : DEFAULT_SALARY_ASSUMPTIONS.maaserRate,
    children: s.children,
    tax: { filingStatus: s.filingStatus, children: s.children },
    currentSalary: structuredClone(s.current),
    additionalSalary: null,
  };
}

/**
 * The charity pot "Charity", at 5 percent, in the demo's own shape; its rate is
 * demoSalary().maaserRate and its account is the one demoAccounts() flags with maaserPot.
 */
export function demoPot(): DemoPot {
  return structuredClone(DEMO.pot);
}

/** The charity pot "Charity" as the app reads it: everyone's pay counts, floor 0. */
export function demoCharityPot(): CharityPot {
  const p = DEMO.pot;
  return {
    on: p.on, name: p.name, kind: p.kind,
    rateBps: p.kind === "percent" ? Math.round(p.amount * 100) : null,
    fixedCents: p.kind === "percent" ? null : p.amount,
    fixedFrom: p.kind === "percent" ? null : DEMO.plan.startDate.slice(0, 7),
    counts: { me: true, partner: true, joint: true },
    floorCents: 0,
  };
}
