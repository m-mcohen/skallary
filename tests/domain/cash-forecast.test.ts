// tests/domain/cash-forecast.test.ts
//
// The charity share is a tenth of pay into the bank (after tax and benefits); figures below are worked by hand.
//
// Forecast runs real income against real costs. The budget's costs each month,
// the current salary's take-home from its start month, the additional salary; goal savings are
// never in it. Under a what-if: its salary from its own start month (else the
// real salary's), its additional salary (else the real one), and its costs from
// the what-if salary's start month (next month when it has no salary). A Car or
// Mortgage row's down payment leaves cash in the month its payments begin, and
// the payments run the loan's term.
//
// Every expected figure is worked by hand here from the 2026 MFJ constants
// (standard deduction $32,200; 10% to $24,800, 12% to $100,800, 22% to
// $211,400; child credit $2,200; 7.65% payroll under the wage base).
import { describe, expect, test } from "vitest";
import { cashForecast } from "../../src/domain/cash-forecast";
import type { SalaryAssumptions } from "../../src/domain/salary";
import type { BudgetLine, Goal } from "../../src/domain/plan-types";
import type { WhatIf, WhatIfChange } from "../../src/domain/what-if";

const AS_OF = "2026-10-15"; // the forecast runs Nov 2026 to Oct 2028
// Premium $500 a month, charity share 10%, one child.
const BASE: SalaryAssumptions = { premiumMonthlyCents: 50_000, maaserRate: 0.1, children: 1 };
const LINES: BudgetLine[] = [
  { planId: "p", planningCategory: "Living", period: null, amountCents: 500_000 }, // $5,000
  { planId: "p", planningCategory: "Charity", period: null, amountCents: 30_000 }, // $300
];
const net = (months: { period: string; netCents: number }[], period: string) => months.find((m) => m.period === period)!.netCents / 100;
const income = (months: { period: string; incomeCents: number }[], period: string) => months.find((m) => m.period === period)!.incomeCents / 100;

// A $96,000 salary: wages 96,000 - 6,000 = 90,000. Payroll 7.65% = 6,885.
// Federal: taxable 57,800: 2,480 + 12% x 33,000 = 3,960; 6,440 less 2,200 = 4,240.
// After tax 96,000 - 6,885 - 4,240 = 84,875. Paycheck (84,875 - 6,000) / 12 = 6,572.9167 -> $6,572.92.
// Charity share on what lands in the bank: (84,875 - 6,000) x 10% = 7,887.50 / 12 = 657.2917 -> $657.29,
// which raises the $300 Charity line to $657.29.
const PAY_96K = 6_572.92;

describe("real income against real costs", () => {
  test("no salary set: the budget's costs, nothing coming in", () => {
    const m = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: BASE });
    expect(m).toHaveLength(24);
    expect(m[0].period).toBe("2026-11");
    expect(net(m, "2026-11")).toBe(-5_300);
    expect(net(m, "2028-10")).toBe(-5_300);
  });

  test("a gross salary counts from its start month, after tax and the premium, and its charity share raises Charity", () => {
    const a = { ...BASE, currentSalary: { kind: "gross" as const, grossAnnualCents: 9_600_000, fromPeriod: "2026-12" } };
    const m = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: a });
    expect(net(m, "2026-11")).toBe(-5_300); // before it starts
    expect(income(m, "2026-12")).toBe(PAY_96K);
    // 6,572.92 - 5,000 - 657.29 = 915.63
    expect(net(m, "2026-12")).toBe(915.63);
  });

  test("a typed monthly take-home is the amount that lands in the bank: no tax math, Charity stays as budgeted", () => {
    const a = { ...BASE, currentSalary: { kind: "take-home" as const, monthlyCents: 700_000, fromPeriod: "2026-11" } };
    const m = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: a });
    // 7,000 - 5,000 - 300 = 1,700
    expect(net(m, "2026-11")).toBe(1_700);
  });

  test("an additional W-2 salary joins from its own month and is taxed jointly with the current one", () => {
    const a = {
      ...BASE,
      currentSalary: { kind: "gross" as const, grossAnnualCents: 9_600_000, fromPeriod: "2026-11" },
      additionalSalary: { kind: "w2" as const, grossAnnualCents: 4_000_000, fromPeriod: "2027-01" },
    };
    const m = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: a });
    expect(net(m, "2026-12")).toBe(915.63); // the current salary alone, as above
    // From Jan 2027, both: wages 90,000 + 40,000. Payroll 6,885 + 3,060 = 9,945.
    // Federal: taxable 97,800: 2,480 + 12% x 73,000 = 8,760; 11,240 less 2,200 = 9,040.
    // After tax 136,000 - 9,945 - 9,040 = 117,015. Paycheck (117,015 - 6,000) / 12 = 9,251.25.
    // Charity share (117,015 - 6,000) x 10% = 11,101.50 / 12 = 925.125 -> $925.13 (rounded once). Net 9,251.25 - 5,000 - 925.13 = 3,326.12.
    expect(income(m, "2027-01")).toBe(9_251.25);
    expect(net(m, "2027-01")).toBe(3_326.12);
  });

  test("an additional monthly amount adds as it is, from its month", () => {
    const a = {
      ...BASE,
      currentSalary: { kind: "take-home" as const, monthlyCents: 700_000, fromPeriod: "2026-11" },
      additionalSalary: { kind: "monthly" as const, monthlyCents: 150_000, fromPeriod: "2026-12" },
    };
    const m = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: a });
    expect(net(m, "2026-11")).toBe(1_700);
    expect(net(m, "2026-12")).toBe(3_200); // 7,000 + 1,500 - 5,300
  });

  test("if no money came in: the same costs, no income, and Charity as budgeted", () => {
    const a = { ...BASE, currentSalary: { kind: "gross" as const, grossAnnualCents: 9_600_000, fromPeriod: "2026-11" } };
    const m = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: a, noIncome: true });
    expect(net(m, "2026-11")).toBe(-5_300);
    expect(income(m, "2026-11")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Under a what-if
// ---------------------------------------------------------------------------

const change = (c: Partial<WhatIfChange> & Pick<WhatIfChange, "id" | "kind" | "planningCategory" | "amountCents">): WhatIfChange => ({
  position: 1,
  label: c.planningCategory,
  // A stored start month the forecast no longer reads (costs carry no start month).
  fromPeriod: "2026-11",
  untilPeriod: null,
  loan: null,
  ...c,
});

// Rent: add $1,000. Car: $30,000, $5,000 down, 0%, one year -> $25,000 / 12 = $2,083.33 a month.
const RENT = change({ id: "rent", kind: "add", planningCategory: "Rent", amountCents: 100_000, position: 1 });
const CAR = change({
  id: "car", kind: "car", planningCategory: "Car payment", amountCents: 208_333, position: 2, untilPeriod: "2027-10",
  loan: { priceCents: 3_000_000, downPaymentCents: 500_000, annualRate: 0, years: 1 },
});

const whatIf = (w: Partial<WhatIf>): WhatIf => ({ scenarioId: "w", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [], ...w });

describe("under a what-if", () => {
  // Real salary $96,000 from Jan 2027.
  const REAL = { ...BASE, currentSalary: { kind: "gross" as const, grossAnnualCents: 9_600_000, fromPeriod: "2027-01" } };

  test("its salary, with no start month of its own, starts with the real salary; its costs start then too; the car's down payment leaves that month and its payments run the loan's year", () => {
    const w = whatIf({ salaryGrossAnnualCents: 15_000_000, changes: [RENT, CAR] });
    const m = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: REAL, whatIf: w });
    // Nov and Dec 2026: nothing in, and no what-if cost yet (Rent's stored Nov 2026 is not read).
    expect(net(m, "2026-11")).toBe(-5_300);
    expect(net(m, "2026-12")).toBe(-5_300);
    // From Jan 2027 the what-if's $150,000: wages 144,000; payroll 11,016;
    // federal: taxable 111,800 -> 14,020 less 2,200 = 11,820; after tax 127,164.
    // Paycheck (127,164 - 6,000) / 12 = 10,097.00. Charity share (127,164 - 6,000) x 10% = 12,116.40 / 12 = 1,009.70.
    expect(income(m, "2027-01")).toBe(10_097);
    // Jan 2027 costs: 5,000 + rent 1,000 + car 2,083.33 + Charity 1,009.70 + down payment 5,000 = 14,093.03.
    expect(net(m, "2027-01")).toBe(-3_996.03);
    // Feb to Dec 2027: 9,093.03 out -> +1,003.97.
    expect(net(m, "2027-02")).toBe(1_003.97);
    expect(net(m, "2027-12")).toBe(1_003.97);
    // Jan 2028: twelve payments made, the car is paid off: 7,009.70 out -> +3,087.30.
    expect(net(m, "2028-01")).toBe(3_087.3);
  });

  test("its salary's own start month moves its income and its costs; the current salary runs until it takes over", () => {
    const w = whatIf({ salaryGrossAnnualCents: 15_000_000, salaryFromPeriod: "2027-03", changes: [RENT] });
    const m = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: REAL, whatIf: w });
    // Jan and Feb 2027: the real $96,000 runs until the what-if's salary takes over, and rent has
    // not started: 6,572.92 in; 5,000 + 657.29 out -> 915.63.
    expect(net(m, "2026-12")).toBe(-5_300);
    expect(net(m, "2027-01")).toBe(915.63);
    expect(net(m, "2027-02")).toBe(915.63);
    // Mar 2027: 10,097 in; 5,000 + 1,000 + 1,009.70 out -> 3,087.30.
    expect(net(m, "2027-03")).toBe(3_087.3);
  });

  test("a what-if with no salary keeps the real salary, and its costs start next month", () => {
    const w = whatIf({ changes: [RENT] });
    const m = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: REAL, whatIf: w });
    expect(net(m, "2026-11")).toBe(-6_300); // rent from next month, no income yet
    // Jan 2027: the real $96,000: 6,572.92 in; 5,000 + 1,000 + 657.29 out -> 915.63 - 1,000 = -84.37.
    expect(net(m, "2027-01")).toBe(-84.37);
  });

  test("a mortgage's payments run its term, then its property tax and insurance keep going", () => {
    // $12,000, nothing down, 0%, one year -> $1,000 a month, plus $1,200 a year of tax -> $100: $1,100.
    const house = change({
      id: "house", kind: "mortgage", planningCategory: "Mortgage", amountCents: 110_000,
      loan: { priceCents: 1_200_000, downPaymentCents: 0, annualRate: 0, years: 1, propertyTaxYearCents: 120_000, insuranceYearCents: 0 },
    });
    const m = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: BASE, whatIf: whatIf({ changes: [house] }) });
    expect(net(m, "2026-11")).toBe(-6_400); // 5,300 + 1,100
    expect(net(m, "2027-10")).toBe(-6_400); // twelfth payment
    expect(net(m, "2027-11")).toBe(-5_400); // 5,300 + 100 of tax
  });

  test("its additional salary replaces the real one, and None takes it away", () => {
    const a = { ...BASE, currentSalary: { kind: "take-home" as const, monthlyCents: 700_000, fromPeriod: "2026-11" }, additionalSalary: { kind: "monthly" as const, monthlyCents: 150_000, fromPeriod: "2026-11" } };
    const same = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: a, whatIf: whatIf({}) });
    expect(net(same, "2026-11")).toBe(3_200); // 7,000 + 1,500 - 5,300: defaults to the real one
    const none = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: a, whatIf: whatIf({ additionalSalary: "none" }) });
    expect(net(none, "2026-11")).toBe(1_700);
    // Its own from Dec 2026 takes over from the real one then; the real one runs until it does.
    const other = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: a, whatIf: whatIf({ additionalSalary: { kind: "monthly", monthlyCents: 300_000, fromPeriod: "2026-12" } }) });
    expect(net(other, "2026-11")).toBe(3_200);
    expect(net(other, "2026-12")).toBe(4_700); // 7,000 + 3,000 - 5,300
  });

  test("a goal's ongoing cost counts from the cost start; its saving never does", () => {
    const goal: Goal = {
      id: "g", name: "House", goalType: "savings", targetAmountCents: 10_000_000, targetDate: "2028-12-31", priority: 1,
      currentAmountCents: 0, plannedMonthlyCents: 100_000, notes: "", archivedAt: null, ongoingMonthlyCents: 20_000,
    };
    // Today's tick is two rows, its saving and its ongoing cost, both switched on.
    const w = whatIf({ rows: [{ kind: "goal-saving", refId: "g", position: 1, on: true }, { kind: "goal-cost", refId: "g", position: 2, on: true }] });
    const m = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: BASE, whatIf: w, goals: [goal] });
    // 5,300 + the $200 ongoing cost; the $1,000 a month of saving is not a cost here.
    expect(net(m, "2026-11")).toBe(-5_500);
  });
});

test("a big month is paid in its month under Real numbers, and only then", () => {
  const big = [{ id: 1, planId: "p", planningCategory: "Gifts", month: "2026-12", label: "Hanukkah gifts", amountCents: 80_000, createdAt: "" }];
  const base = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: BASE });
  const withBig = cashForecast({ budgetLines: LINES, asOfDate: AS_OF, assumptions: BASE, bigMonths: big });
  const cost = (rows: typeof base, period: string) => rows.find((m) => m.period === period)!.costCents;
  expect(cost(withBig, "2026-12") - cost(base, "2026-12")).toBe(80_000);
  expect(cost(withBig, "2026-11")).toBe(cost(base, "2026-11"));
  expect(cost(withBig, "2027-12")).toBe(cost(base, "2027-12"));
});
