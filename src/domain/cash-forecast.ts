// src/domain/cash-forecast.ts
//
// The Forecast screen's projection: "an adjustable cash flow forecast. By default, it
// should calculate my real costs against my real income, but by changing the
// salary, costs, and goals, I should be able to adjust this forecast."
//
// Each month from next month, for 24 months:
//   money in  = the user's salary (Settings, Salary) from its start month, after tax
//               and the premium, or the typed monthly pay into the bank as it is;
//               plus the additional salary from its month (a W-2 salary taxed
//               with the user's (one return when filing jointly), or a monthly amount as it is); plus any income
//               line the budget itself carries;
//   money out = the budget's costs that month, with the Charity line raised to
//               the charity pot's month when that is more (the ladder's rule).
// Goal savings are never in it.
//
// Under a what-if: its salary from its own start month, else the real salary's,
// with the real salary counting until it takes over; its
// additional salary, else the real one (likewise); and its costs from
// the what-if salary's start month, or next month when it has no salary (open
// point 1, B). Stored start and end months on the changes are not read (costs
// carry no start month). A Car or Mortgage row's down
// payment leaves cash in the month its payments begin, and the payments run the
// loan's term (open point 2, A); a mortgage's property tax and insurance keep
// going after payoff, as on the ladder. A switched-on goal cost row counts
// from the same month. Only switched-on rows count;
// goal saving rows never do. A switched-on one-time cost is paid once, in its own
// month. Pure; integer cents.
import { resolveMonthlyPlan } from "./budget";
import { isIncomeCategory } from "./dedup";
import { addMonths } from "./scenario";
import { RUNWAY_HORIZON_MONTHS } from "./runway-projection";
import { currentSalaryBreakdownRaw, jointBreakdownRaw, monthlyPayCents, roundAll, type SalaryAssumptions } from "./salary";
import { potMonthCents } from "./charity-pot";
import type { AdditionalSalary, CurrentSalary } from "./income";
import type { BigMonth, BudgetLine, Goal } from "./plan-types";
import {
  CHARITY_LINE,
  assumptionsUnder,
  datedChange,
  forecastCostStart,
  lineAfterChanges,
  onChanges,
  oneTimeCosts,
  plannedGoalCosts,
  whatIfSalaryStart,
  type WhatIf,
} from "./what-if";

export interface CashForecastInput {
  budgetLines: BudgetLine[];
  /** ISO date; the forecast starts the month after this one. */
  asOfDate: string;
  /** Settings, Salary, including the current and additional salary. */
  assumptions: SalaryAssumptions;
  /** The what-if that is on, if any. */
  whatIf?: WhatIf | null;
  /** The goals, so a switched-on goal cost row counts (a goal's saving never does). */
  goals?: Goal[];
  horizonMonths?: number;
  /** "If no money came in": the same costs, no income of any kind, Charity as budgeted. */
  noIncome?: boolean;
  /** Planned big months on the real budget: each paid in its own month. */
  bigMonths?: BigMonth[];
}

export interface CashForecastMonth {
  period: string;
  /** Money in that month. */
  incomeCents: number;
  /** Money out that month, positive. */
  costCents: number;
  /** In less out. */
  netCents: number;
}

/**
 * Who earns what under the what-if (or the real income when none is on). A
 * what-if's own salary, or its own additional salary, takes over from its start
 * month; until then the real one in Settings, Salary keeps counting (`mainBefore`,
 * `otherBefore`). "None" for the additional salary removes it outright.
 */
export interface ForecastEarners {
  main: CurrentSalary | null;
  /** True when `main` is the real current salary from Settings, so its firm tax figures apply. */
  mainIsReal?: boolean;
  other: AdditionalSalary | null;
  mainBefore?: CurrentSalary | null;
  otherBefore?: AdditionalSalary | null;
}

export function forecastEarners(a: SalaryAssumptions, whatIf: WhatIf | null | undefined, nextMonth: string): ForecastEarners {
  const real = a.currentSalary ?? null;
  const realOther = a.additionalSalary ?? null;
  const own = whatIf && whatIf.additionalSalary && whatIf.additionalSalary !== "none" ? whatIf.additionalSalary : null;
  const other = assumptionsUnder(a, whatIf).additionalSalary ?? null;
  const otherBefore = own ? realOther : null;
  if (whatIf && whatIf.salaryGrossAnnualCents !== null) {
    return {
      main: { kind: "gross", grossAnnualCents: whatIf.salaryGrossAnnualCents, fromPeriod: whatIfSalaryStart(whatIf, a) ?? nextMonth },
      other,
      mainBefore: real,
      otherBefore,
    };
  }
  return { main: real, mainIsReal: true, other, otherBefore };
}

/**
 * One month of income: what lands in the bank, and the charity pot's month. W-2
 * pay is worked under the household's filing status for whoever is earning that month (tax, payroll per
 * earner, the premium while the first earner draws a salary). A typed take-home
 * and a monthly additional amount are added as they are, with no tax math and no
 * share of them going to the pot. A set-amount pot's month does not depend on pay.
 */
export function monthIncome(period: string, earners: ForecastEarners, a: SalaryAssumptions): { bankCents: number; maaserCents: number } {
  const on = (s: { fromPeriod: string } | null | undefined) => !!s && s.fromPeriod <= period;
  // A what-if's own salary takes over from its month; the real one counts until then.
  const main = on(earners.main) ? earners.main : on(earners.mainBefore) ? earners.mainBefore ?? null : null;
  const other = on(earners.other) ? earners.other : on(earners.otherBefore) ? earners.otherBefore ?? null : null;
  const hisGross = main && main.kind === "gross" && on(main) ? main.grossAnnualCents : null;
  const otherW2 = other && other.kind === "w2" && on(other) ? other.grossAnnualCents : 0;
  // Firm tax figures are the user's current salary's only: the real salary
  // before a what-if's takes over, or the real salary itself.
  const isCurrent = !!main && ((main === earners.main && earners.mainIsReal === true) || main === earners.mainBefore);
  let bankCents = 0;
  let maaserCents = 0;
  // The pot's pay base: W-2 pay after tax and benefits, a year (0 with no W-2 pay).
  let potBaseAnnualCents = 0;
  if (hisGross !== null || otherW2 > 0) {
    // The rounded breakdown and monthlyPayCents, the one
    // rounding path the statement and Check a salary take, so a month here
    // equals theirs to the cent. The monthly amount below is added as it is, as there.
    const b = roundAll(isCurrent ? currentSalaryBreakdownRaw(hisGross, otherW2, 0, 0, a) : jointBreakdownRaw(hisGross, otherW2, 0, 0, a));
    const pay = monthlyPayCents(b, a);
    bankCents += pay.paycheckCents;
    maaserCents = pay.maaserCents;
    potBaseAnnualCents = b.afterTaxAnnualCents - b.premiumAnnualCents;
  }
  // With a pot passed, its month: the same rounding as monthlyPayCents for a percent pot.
  if (a.pot !== undefined) maaserCents = a.pot === null ? 0 : potMonthCents(a.pot, period, potBaseAnnualCents);
  if (main && main.kind === "take-home" && on(main)) bankCents += main.monthlyCents;
  if (other && other.kind === "monthly" && on(other)) bankCents += other.monthlyCents;
  return { bankCents, maaserCents };
}

export function cashForecast(input: CashForecastInput): CashForecastMonth[] {
  const { budgetLines, asOfDate, whatIf = null, goals = [], noIncome = false, bigMonths = [] } = input;
  const a = input.assumptions;
  const horizon = input.horizonMonths ?? RUNWAY_HORIZON_MONTHS;
  const asOfMonth = asOfDate.slice(0, 7);
  const nextMonth = addMonths(asOfMonth, 1);

  const costStart = whatIf ? forecastCostStart(whatIf, a, nextMonth) : nextMonth;
  // Switched-on changes only, each from the cost start.
  const changes = whatIf ? onChanges(whatIf).map((c) => datedChange(c, costStart)) : [];
  const goalCostCents = whatIf ? plannedGoalCosts(whatIf, goals).reduce((sum, c) => sum + c.monthlyCents, 0) : 0;
  const downPaymentCents = changes.reduce((sum, c) => sum + (c.loan && c.loan.downPaymentCents > 0 ? c.loan.downPaymentCents : 0), 0);
  // Paid once, in the month it names.
  const once = whatIf ? oneTimeCosts(whatIf) : [];
  const earners = forecastEarners(a, whatIf, nextMonth);
  const under = assumptionsUnder(a, whatIf);

  const categories = [...new Set([...budgetLines.map((l) => l.planningCategory), ...changes.map((c) => c.planningCategory), CHARITY_LINE])];
  const costCategories = categories.filter((c) => !isIncomeCategory(c));
  const incomeCategories = categories.filter(isIncomeCategory);

  const out: CashForecastMonth[] = [];
  for (let i = 1; i <= horizon; i++) {
    const period = addMonths(asOfMonth, i);
    const pay = noIncome ? { bankCents: 0, maaserCents: 0 } : monthIncome(period, earners, under);
    let incomeCents = pay.bankCents;
    if (!noIncome) for (const c of incomeCategories) incomeCents += resolveMonthlyPlan(budgetLines, c, period);

    let costCents = 0;
    for (const c of costCategories) {
      let amount = changes.length > 0 ? lineAfterChanges(changes, budgetLines, c, period) : resolveMonthlyPlan(budgetLines, c, period);
      if (c === CHARITY_LINE) amount = Math.max(amount, pay.maaserCents);
      costCents += amount;
    }
    if (period === costStart) costCents += downPaymentCents;
    for (const c of once) if (c.fromPeriod === period) costCents += c.amountCents;
    for (const b of bigMonths) if (b.month === period) costCents += b.amountCents;
    if (period >= costStart) costCents += goalCostCents;

    out.push({ period, incomeCents, costCents, netCents: incomeCents - costCents });
  }
  return out;
}
