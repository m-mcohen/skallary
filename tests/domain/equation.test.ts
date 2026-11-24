// tests/domain/equation.test.ts
//
// The top bar's statement (top-bar equation design): into the bank, less the charity pot put
// away, less the budget, equals left over. Made-up figures; every total is checked against the
// Budget screen's own functions so the bar can never disagree with it.
import { describe, expect, test } from "vitest";
import { monthEquation, paySteps, payStepsEstimated, yearEquation, yearPaySteps, yearPayStepsEstimated, type EquationInput } from "../../src/domain/equation";
import type { WhatIf } from "../../src/domain/what-if";
import { monthIncome, forecastEarners } from "../../src/domain/cash-forecast";
import { budgetLeftOver } from "../../src/domain/budget-month";
import { lineBudget, settingsMoneyIn } from "../../src/domain/budget-income";
import { demoSalary } from "../demo";
import type { BigMonth, BudgetLine } from "../../src/domain/plan-types";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const P = "plan-2026";
const ACCOUNTS: Account[] = [{ id: "checking", name: "Pinecrest Joint Checking", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" }];
let n = 0;
const txn = (date: string, cat: string, amountCents: number): NormalizedTxn => ({
  sourceTransactionId: `e${++n}`, accountId: "checking", date, amountCents, sourceCategory: cat, merchant: cat, isTransfer: false, sourceUpdatedAt: null,
});
const line = (cat: string, amountCents: number): BudgetLine => ({ planId: P, planningCategory: cat, period: null, amountCents, source: "you" });
const MAPPING = { Groceries: "Groceries", Rent: "Rent", Gas: "Gas", Charity: "Charity", Paychecks: "Paychecks" };
const BIG: BigMonth = { id: 1, planId: P, planningCategory: "Groceries", month: "2026-12", label: "Holiday groceries", amountCents: 65000, createdAt: "" };
const TXNS: NormalizedTxn[] = [
  txn("2027-01-02", "Groceries", -21000),
  txn("2027-01-05", "Rent", -200000),
  txn("2027-01-09", "Charity", -30000), // a gift: never in Spent so far
  txn("2027-01-12", "Gas", -4000),
  txn("2027-01-20", "Groceries", -9000), // after the 13th: not yet spent on the 13th
  txn("2026-10-04", "Groceries", -50000),
];
export const INPUT: EquationInput = {
  prepared: TXNS,
  accounts: ACCOUNTS,
  mapping: MAPPING,
  // The Charity line's own budget ($100) sits below the charity pot once the salary starts.
  lines: [line("Groceries", 85000), line("Rent", 200000), line("Gas", 10000), line("Charity", 10000)],
  changes: [],
  bigMonths: [BIG],
  salary: { ...demoSalary(), currentSalary: { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "2026-11" } },
};

describe("month statement", () => {
  test("left over is the Budget screen's left over, in a usual month, a big month, and with Charity above the pot", () => {
    expect(monthEquation(INPUT, "2027-01", "2027-01-13").leftOverCents).toBe(budgetLeftOver(INPUT, "2027-01").leftOverCents);
    expect(monthEquation(INPUT, "2026-12", "2027-01-13").leftOverCents).toBe(budgetLeftOver(INPUT, "2026-12").leftOverCents);
    const generous: EquationInput = { ...INPUT, lines: [...INPUT.lines.filter((l) => l.planningCategory !== "Charity"), line("Charity", 500000)] };
    expect(monthEquation(generous, "2027-01", "2027-01-13").leftOverCents).toBe(budgetLeftOver(generous, "2027-01").leftOverCents);
  });

  test("the terms add up on screen: bank less the charity pot less budget is left over", () => {
    const e = monthEquation(INPUT, "2027-01", "2027-01-13");
    const pay = settingsMoneyIn(INPUT.salary, "2027-01");
    expect(e.bankCents).toBe(pay.paycheckCents);
    expect(e.maaserCents).toBe(pay.maaserCents);
    expect(e.bankCents! - e.maaserCents! - e.budgetCents).toBe(e.leftOverCents);
  });

  test("giving above the pot stays in the budget term", () => {
    const generous: EquationInput = { ...INPUT, lines: [...INPUT.lines.filter((l) => l.planningCategory !== "Charity"), line("Charity", 500000)] };
    const e = monthEquation(generous, "2027-01", "2027-01-13");
    expect(e.maaserCents).toBe(settingsMoneyIn(INPUT.salary, "2027-01").maaserCents);
    expect(e.budgetCents).toBe(85000 + 200000 + 10000 + (500000 - e.maaserCents!));
  });

  test("a big month is named in the budget term", () => {
    expect(monthEquation(INPUT, "2026-12", "2026-12-03").bigMonths).toEqual([{ label: "Holiday groceries", cents: 65000 }]);
    expect(monthEquation(INPUT, "2027-01", "2027-01-13").bigMonths).toEqual([]);
  });

  test("spent so far counts this month to today, Charity left out, against the budget without the Charity line", () => {
    const e = monthEquation(INPUT, "2027-01", "2027-01-13");
    expect(e.spentSoFarCents).toBe(21000 + 200000 + 4000);
    const charity = lineBudget(INPUT, "Charity", "spending", "2027-01").cents!;
    expect(e.spentAgainstCents).toBe(budgetLeftOver(INPUT, "2027-01").spendingCents - charity);
    expect(e.spentAgainstCents).toBe(85000 + 200000 + 10000);
  });

  test("days: day 13 of 31 this month; none for a finished month", () => {
    const now = monthEquation(INPUT, "2027-01", "2027-01-13");
    expect(now.day).toBe(13);
    expect(now.daysInMonth).toBe(31);
    expect(monthEquation(INPUT, "2026-12", "2027-01-13").day).toBeNull();
    expect(monthEquation(INPUT, "2026-12", "2027-01-13").daysInMonth).toBe(31);
  });

  test("a month before the salary has no pay, no charity pot and no left over, never zero; budget and spent still show", () => {
    const e = monthEquation(INPUT, "2026-10", "2026-10-29");
    expect(e.bankCents).toBeNull();
    expect(e.maaserCents).toBeNull();
    expect(e.leftOverCents).toBeNull();
    expect(e.noSalaryMonth).toBe("2026-10");
    expect(e.budgetCents).toBe(budgetLeftOver(INPUT, "2026-10").spendingCents);
    expect(e.spentSoFarCents).toBe(50000);
    expect(monthEquation(INPUT, "2027-01", "2027-01-13").noSalaryMonth).toBeNull();
  });
});

// A 2026 budget year: actual pay and spending January to November, the salary in Settings from November.
const Y2026 = { startDate: "2026-01-01", endDate: "2026-12-31" };
const JAN_NOV = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const YEAR_INPUT: EquationInput = {
  ...INPUT,
  prepared: [
    ...JAN_NOV.map((m) => txn(`${m}-28`, "Paychecks", 500000)),
    ...JAN_NOV.map((m) => txn(`${m}-06`, "Groceries", -70000)),
    ...JAN_NOV.map((m) => txn(`${m}-07`, "Charity", -40000)),
    txn("2026-12-02", "Gas", -3000),
  ],
};

describe("year statement", () => {
  test("finished months count what happened; this month and later count the budget", () => {
    const y = yearEquation(YEAR_INPUT, Y2026, "2026-12-03");
    const dec = monthEquation(YEAR_INPUT, "2026-12", "2026-12-03");
    expect(y.bankCents).toBe(11 * 500000 + dec.bankCents!);
    // The pot's 5% of each finished month's pay.
    expect(y.maaserCents).toBe(11 * 25000 + dec.maaserCents!);
    const spendingTotal = 11 * (70000 + 40000) + (dec.budgetCents + dec.maaserCents!);
    expect(y.leftOverCents).toBe(y.bankCents! - spendingTotal);
    expect(y.leftOverCents).toBe(y.bankCents! - (y.maaserCents! + y.budgetCents));
  });

  test("early in a month, before payday, the year still counts this month's pay (payroll lands at month end)", () => {
    const y2027 = { startDate: "2027-01-01", endDate: "2027-12-31" };
    const y = yearEquation(INPUT, y2027, "2027-01-03");
    const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m) => `2027-${m}`);
    expect(y.bankCents).toBe(months.reduce((s, m) => s + monthEquation(INPUT, m, "2027-01-03").bankCents!, 0));
    expect(y.mixedNote).toBeNull();
    expect(y.monthsWithoutPay).toEqual([]);
  });

  test("a year the salary only partly covers says so", () => {
    expect(yearEquation(YEAR_INPUT, Y2026, "2026-12-03").mixedNote).toBe("Jan to Nov actual, Dec budget");
    expect(yearEquation(YEAR_INPUT, Y2026, "2026-10-03").mixedNote).toBe("Jan to Sep actual, Oct to Dec budget");
  });

  test("a coming month with no pay is named, and left over is still a number", () => {
    const y = yearEquation(YEAR_INPUT, Y2026, "2026-10-03");
    expect(y.monthsWithoutPay).toEqual(["2026-10"]);
    expect(y.leftOverCents).not.toBeNull();
  });

  test("spent so far is the year to date with Charity left out; measured against actual then budget, Charity left out", () => {
    const y = yearEquation(YEAR_INPUT, Y2026, "2026-12-03");
    const dec = monthEquation(YEAR_INPUT, "2026-12", "2026-12-03");
    expect(y.spentSoFarCents).toBe(11 * 70000 + 3000);
    expect(y.spentAgainstCents).toBe(11 * 70000 + dec.spentAgainstCents);
    expect(y.bigMonths).toEqual([{ label: "Holiday groceries", cents: 65000 }]);
  });
});

describe("pay steps behind the info point", () => {
  test("a month's steps run from gross pay to take-home, and the bank line is the month's pay", () => {
    const steps = paySteps(INPUT, "2027-01", "monthly")!;
    expect(steps[0].id).toBe("gross");
    expect(steps[steps.length - 1].id).toBe("take-home");
    const pay = settingsMoneyIn(INPUT.salary, "2027-01");
    expect(steps.find((l) => l.id === "bank")!.cents).toBe(pay.paycheckCents);
    expect(steps.find((l) => l.id === "maaser")!.cents).toBe(-pay.maaserCents);
    expect(steps.find((l) => l.id === "take-home")!.cents).toBe(pay.paycheckCents! - pay.maaserCents);
  });
  test("no salary, no steps", () => {
    expect(paySteps(INPUT, "2026-10", "monthly")).toBeNull();
  });
});

describe("with a what-if on", () => {
  const WHAT_IF = { scenarioId: "s1", salaryGrossAnnualCents: 9_000_000, salaryFromPeriod: null, additionalSalary: null, rows: [] } as unknown as WhatIf;
  test("this month's pay and charity pot follow the what-if's salary", () => {
    const e = monthEquation({ ...INPUT, whatIf: WHAT_IF }, "2027-01", "2027-01-13");
    const pay = monthIncome("2027-01", forecastEarners(INPUT.salary, WHAT_IF, "2027-02"), INPUT.salary);
    expect(e.bankCents).toBe(pay.bankCents);
    expect(e.maaserCents).toBe(pay.maaserCents);
    expect(e.bankCents).toBeLessThan(monthEquation(INPUT, "2027-01", "2027-01-13").bankCents!);
    expect(e.bankCents! - e.maaserCents! - e.budgetCents).toBe(e.leftOverCents);
  });
  test("finished months in the year do not move", () => {
    const real = yearEquation(YEAR_INPUT, Y2026, "2026-12-03");
    const under = yearEquation({ ...YEAR_INPUT, whatIf: WHAT_IF }, Y2026, "2026-12-03");
    const decReal = monthEquation(YEAR_INPUT, "2026-12", "2026-12-03");
    const decUnder = monthEquation({ ...YEAR_INPUT, whatIf: WHAT_IF }, "2026-12", "2026-12-03");
    expect(under.bankCents! - decUnder.bankCents!).toBe(real.bankCents! - decReal.bankCents!);
  });
});

// Review fixes.
describe("final review: a what-if that changes nothing changes nothing", () => {
  const SAME = { scenarioId: "s2", salaryGrossAnnualCents: 12_000_000, salaryFromPeriod: null, additionalSalary: null, changes: [], rows: [] } as unknown as WhatIf;

  test("a Charity big month is not swallowed by the pot raise", () => {
    const gift: BigMonth = { id: 2, planId: P, planningCategory: "Charity", month: "2027-01", label: "Year-end gift", amountCents: 50000, createdAt: "" };
    const input = { ...INPUT, bigMonths: [...INPUT.bigMonths, gift] };
    const real = monthEquation(input, "2027-01", "2027-01-13");
    expect(monthEquation({ ...input, whatIf: SAME }, "2027-01", "2027-01-13").leftOverCents).toBe(real.leftOverCents);
  });

  test("budgeted income besides the paycheck stays in the bank term", () => {
    const input = { ...INPUT, lines: [...INPUT.lines, line("Business Income", 100000)] };
    const real = monthEquation(input, "2027-01", "2027-01-13");
    expect(real.bankCents).toBe(budgetLeftOver(input, "2027-01").incomeCents);
    expect(monthEquation({ ...input, whatIf: SAME }, "2027-01", "2027-01-13").bankCents).toBe(real.bankCents);
  });

  test("an additional income in force today is kept until a what-if's replacement starts", () => {
    const input: EquationInput = { ...INPUT, salary: { ...INPUT.salary, currentSalary: null, additionalSalary: { kind: "monthly", monthlyCents: 200000, fromPeriod: "2026-01" } } };
    const later = { ...SAME, salaryGrossAnnualCents: null, additionalSalary: { kind: "monthly", monthlyCents: 300000, fromPeriod: "2027-02" } } as unknown as WhatIf;
    const e = monthEquation({ ...input, whatIf: later }, "2027-01", "2027-01-13");
    expect(e.bankCents).toBe(200000);
    expect(e.noSalaryMonth).toBeNull();
  });
});

describe("final review: the Year pay steps explain the Year figure", () => {
  test("the steps' bank line is the year's into the bank, with what already landed on its own line", () => {
    const y = yearEquation(YEAR_INPUT, Y2026, "2026-12-03");
    const steps = yearPaySteps(YEAR_INPUT, Y2026, "2026-12-03")!;
    expect(steps.find((l) => l.id === "landed")!.cents).toBe(11 * 500000);
    expect(steps.find((l) => l.id === "landed")!.label).toBe("Already landed, Jan to Nov");
    expect(steps.find((l) => l.id === "bank")!.cents).toBe(y.bankCents);
    expect(steps.find((l) => l.id === "maaser")!.cents).toBe(-y.maaserCents!);
    expect(steps.find((l) => l.id === "take-home")!.cents).toBe(y.bankCents! - y.maaserCents!);
  });
  test("a year with no finished months has no landed line, and its bank line still matches", () => {
    const y2027 = { startDate: "2027-01-01", endDate: "2027-12-31" };
    const steps = yearPaySteps(INPUT, y2027, "2027-01-03")!;
    expect(steps.some((l) => l.id === "landed")).toBe(false);
    expect(steps.find((l) => l.id === "bank")!.cents).toBe(yearEquation(INPUT, y2027, "2027-01-03").bankCents);
  });
});

// Minors 1 and 2: the steps add up to the bank line, and the estimates note is honest.
describe("minor 2: the pay steps add up exactly to the bank line", () => {
  const beforeBank = (steps: { id: string; cents: number }[]) => steps.slice(0, steps.findIndex((l) => l.id === "bank"));
  const sum = (steps: { cents: number }[]) => steps.reduce((t, l) => t + l.cents, 0);
  const withSalary = (currentSalary: EquationInput["salary"]["currentSalary"], extra: Partial<EquationInput["salary"]> = {}): EquationInput => ({
    ...INPUT,
    salary: { ...demoSalary(), currentSalary, ...extra },
  });

  test("gross less taxes and benefits is the bank line, for salaries that do not divide evenly by 12", () => {
    for (let gross = 8_000_001; gross < 8_000_001 + 40 * 7_919; gross += 7_919) {
      const input = withSalary({ kind: "gross", grossAnnualCents: gross, fromPeriod: "2026-11" });
      const steps = paySteps(input, "2027-01", "monthly")!;
      expect(sum(beforeBank(steps))).toBe(steps.find((l) => l.id === "bank")!.cents);
      expect(steps.find((l) => l.id === "bank")!.cents).toBe(settingsMoneyIn(input.salary, "2027-01").paycheckCents);
    }
  });

  test("an additional monthly amount and other budgeted income are lines too", () => {
    const input: EquationInput = {
      ...withSalary({ kind: "gross", grossAnnualCents: 9_876_543, fromPeriod: "2026-11" }, { additionalSalary: { kind: "monthly", monthlyCents: 123_457, fromPeriod: "2026-11" } }),
      lines: [...INPUT.lines, line("Business Income", 100_001)],
    };
    const steps = paySteps(input, "2027-01", "monthly")!;
    expect(steps.find((l) => l.id === "other-net")!.cents).toBe(123_457);
    expect(sum(beforeBank(steps))).toBe(steps.find((l) => l.id === "bank")!.cents);
  });

  test("a typed take-home with other budgeted income still adds up", () => {
    const input: EquationInput = { ...withSalary({ kind: "take-home", monthlyCents: 654_321, fromPeriod: "2026-11" }), lines: [...INPUT.lines, line("Business Income", 100_001)] };
    const steps = paySteps(input, "2027-01", "monthly")!;
    expect(sum(beforeBank(steps))).toBe(steps.find((l) => l.id === "bank")!.cents);
  });

  test("a typed take-home has one line, so the steps still explain the bank line", () => {
    const input = withSalary({ kind: "take-home", monthlyCents: 654_321, fromPeriod: "2026-11" });
    const steps = paySteps(input, "2027-01", "monthly")!;
    expect(steps.map((l) => l.id)).toEqual(["take-home-typed", "bank", "maaser", "take-home"]);
    expect(steps[0]).toMatchObject({ label: "Take-home typed in Settings", cents: 654_321 });
    expect(steps.find((l) => l.id === "bank")!.cents).toBe(654_321);
  });

  test("the Year steps still add up to the Year bank line, with the new lines summed month by month", () => {
    const input = withSalary({ kind: "gross", grossAnnualCents: 9_876_543, fromPeriod: "2026-11" });
    const y2027 = { startDate: "2027-01-01", endDate: "2027-12-31" };
    const steps = yearPaySteps(input, y2027, "2027-01-03")!;
    expect(sum(beforeBank(steps))).toBe(steps.find((l) => l.id === "bank")!.cents);
  });
});

describe("minor 1: the estimates note only when the steps use estimated taxes", () => {
  const firm = { federalAnnualCents: 1_500_000, payrollAnnualCents: 900_000 };
  const input = (extra: Partial<EquationInput["salary"]>, whatIf?: WhatIf): EquationInput => ({ ...INPUT, salary: { ...INPUT.salary, ...extra }, whatIf });

  test("estimated with no firm figures, firm with both typed", () => {
    expect(payStepsEstimated(input({}), ["2027-01"])).toBe(true);
    expect(payStepsEstimated(input({ firmTaxes: firm }), ["2027-01"])).toBe(false);
  });
  test("one firm figure still leaves the other estimated", () => {
    expect(payStepsEstimated(input({ firmTaxes: { federalAnnualCents: 1_500_000, payrollAnnualCents: null } }), ["2027-01"])).toBe(true);
  });
  test("a what-if's own salary is always estimated, and so is an additional W-2 salary", () => {
    const own = { scenarioId: "s9", salaryGrossAnnualCents: 9_000_000, salaryFromPeriod: null, additionalSalary: null, rows: [] } as unknown as WhatIf;
    expect(payStepsEstimated(input({ firmTaxes: firm }, own), ["2027-01"])).toBe(true);
    expect(payStepsEstimated(input({ firmTaxes: firm, additionalSalary: { kind: "w2", grossAnnualCents: 4_000_000, fromPeriod: "2026-11" } }), ["2027-01"])).toBe(true);
  });
  test("a typed take-home has no estimated taxes in it", () => {
    expect(payStepsEstimated(input({ currentSalary: { kind: "take-home", monthlyCents: 654_321, fromPeriod: "2026-11" } }), ["2027-01"])).toBe(false);
  });
  test("a year is estimated when any month still to come is", () => {
    const y2027 = { startDate: "2027-01-01", endDate: "2027-12-31" };
    expect(yearPayStepsEstimated(input({ firmTaxes: firm }), y2027, "2027-01-03")).toBe(false);
    expect(yearPayStepsEstimated(input({}), y2027, "2027-01-03")).toBe(true);
  });
});

// A what-if's additional salary that starts later must not change the steps before it starts.
describe("review: steps follow monthIncome's earner choice", () => {
  const firm = { federalAnnualCents: 1_500_000, payrollAnnualCents: 900_000 };
  const base: EquationInput = {
    ...INPUT,
    salary: {
      ...demoSalary(),
      firmTaxes: firm,
      currentSalary: { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "2026-01" },
      additionalSalary: { kind: "w2", grossAnnualCents: 4_000_000, fromPeriod: "2026-01" },
    },
  };
  const later = { scenarioId: "s7", salaryGrossAnnualCents: null, salaryFromPeriod: null, additionalSalary: { kind: "w2", grossAnnualCents: 6_000_000, fromPeriod: "2027-06" }, rows: [] } as unknown as WhatIf;

  test("before the what-if's additional salary starts, the real one's lines show and the steps add up", () => {
    const steps = paySteps({ ...base, whatIf: later }, "2027-01", "monthly")!;
    const real = paySteps(base, "2027-01", "monthly")!;
    expect(steps.find((l) => l.id === "other-gross")!.cents).toBe(real.find((l) => l.id === "other-gross")!.cents);
    expect(steps.find((l) => l.id === "federal")!.cents).toBeLessThan(0);
    const k = steps.findIndex((l) => l.id === "bank");
    expect(steps.slice(0, k).reduce((t, l) => t + l.cents, 0)).toBe(steps[k].cents);
  });
  test("and its tax is estimated, so the note stays", () => {
    expect(payStepsEstimated({ ...base, whatIf: later }, ["2027-01"])).toBe(true);
  });
});
