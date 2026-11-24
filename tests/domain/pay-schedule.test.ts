// tests/domain/pay-schedule.test.ts
//
// The federal income tax, Social Security and Medicare, and the health premium are typed
// PER PAYCHECK, as read off the pay stub,
// with a pay schedule chosen once. One function turns a paycheck figure into a year
// (paycheck x paychecks a year, exact cents) and a month (the year / 12, rounded to the
// cent with Math.round, the way monthlyPayCents rounds). The converted figures feed the
// existing paths: the firm taxes stay yearly, the premium stays monthly.
//
// Older saved data: a premium typed as $450.00 A MONTH under the older key, no pay schedule,
// no paycheck figures. Until a paycheck figure is typed, the older monthly premium (and any
// older yearly tax figure) reads exactly as before.
import { describe, expect, test } from "vitest";
import {
  PAY_SCHEDULES,
  isPaySchedule,
  olderFigures,
  paycheckProblem,
  paycheckToMonthAndYear,
  salaryFigures,
} from "../../src/domain/paycheck";
import { currentSalaryBreakdown, type SalaryAssumptions } from "../../src/domain/salary";

describe("the pay schedule", () => {
  test("four choices, chosen once, with plain labels and their paychecks a year", () => {
    expect(PAY_SCHEDULES.map((s) => [s.value, s.label, s.paychecksAYear])).toEqual([
      ["weekly", "Weekly", 52],
      ["every-two-weeks", "Every two weeks", 26],
      ["twice-a-month", "Twice a month", 24],
      ["monthly", "Monthly", 12],
    ]);
    expect(isPaySchedule("every-two-weeks")).toBe(true);
    expect(isPaySchedule("biweekly")).toBe(false);
    expect(isPaySchedule(null)).toBe(false);
  });
});

describe("a paycheck figure, a month and a year", () => {
  test("$780.00 every two weeks", () => {
    // 78,000 x 26 = 2,028,000 cents = $20,280.00 a year; 2,028,000 / 12 = 169,000 = $1,690.00 a month (exact).
    expect(paycheckToMonthAndYear(78_000, "every-two-weeks")).toEqual({ yearlyCents: 2_028_000, monthlyCents: 169_000 });
  });

  test("$300.03 every two weeks: the month rounds half a cent up, as the app rounds", () => {
    // 30,003 x 26 = 780,078 = $7,800.78 a year; 780,078 / 12 = 65,006.5, Math.round = 65,007 = $650.07 a month.
    expect(paycheckToMonthAndYear(30_003, "every-two-weeks")).toEqual({ yearlyCents: 780_078, monthlyCents: 65_007 });
  });

  test("weekly, twice a month and monthly", () => {
    // $100.01 weekly: 10,001 x 52 = 520,052 = $5,200.52 a year; 520,052 / 12 = 43,337.67, rounds to 43,338 = $433.38.
    expect(paycheckToMonthAndYear(10_001, "weekly")).toEqual({ yearlyCents: 520_052, monthlyCents: 43_338 });
    // $333.33 twice a month: 33,333 x 24 = 799,992 = $7,999.92 a year; / 12 = 66,666 = $666.66 a month.
    expect(paycheckToMonthAndYear(33_333, "twice-a-month")).toEqual({ yearlyCents: 799_992, monthlyCents: 66_666 });
    // $450.00 monthly: 45,000 x 12 = 540,000 = $5,400.00 a year; / 12 = 45,000 = $450.00 a month.
    expect(paycheckToMonthAndYear(45_000, "monthly")).toEqual({ yearlyCents: 540_000, monthlyCents: 45_000 });
  });

  test("a zero paycheck figure is zero", () => {
    expect(paycheckToMonthAndYear(0, "weekly")).toEqual({ yearlyCents: 0, monthlyCents: 0 });
  });
});

describe("which figure the app uses: the paycheck figure, else an older figure, else the estimate", () => {
  const none = { federalCents: null, payrollCents: null, premiumCents: null };

  test("older saved data as it stands: the $450.00 typed a month still reads $450.00 a month; taxes estimated", () => {
    expect(salaryFigures({ paySchedule: null, paycheck: null, olderPremiumMonthlyCents: 45_000, olderFirmTaxes: null })).toEqual({ premiumMonthlyCents: 45_000, firmTaxes: null });
  });

  test("picking a schedule alone moves nothing", () => {
    expect(salaryFigures({ paySchedule: "every-two-weeks", paycheck: none, olderPremiumMonthlyCents: 45_000, olderFirmTaxes: null })).toEqual({ premiumMonthlyCents: 45_000, firmTaxes: null });
  });

  test("a typed paycheck premium replaces the older monthly one", () => {
    // $300.03 every two weeks = $650.07 a month (worked above).
    expect(salaryFigures({ paySchedule: "every-two-weeks", paycheck: { ...none, premiumCents: 30_003 }, olderPremiumMonthlyCents: 45_000, olderFirmTaxes: null }).premiumMonthlyCents).toBe(65_007);
  });

  test("paycheck taxes become the yearly firm figures; a blank one keeps an older yearly figure, else the estimate", () => {
    // Federal $780.00 every two weeks = $20,280.00 a year (worked above).
    const older = { federalAnnualCents: 1_200_000, payrollAnnualCents: 1_100_000 };
    expect(salaryFigures({ paySchedule: "every-two-weeks", paycheck: { ...none, federalCents: 78_000 }, olderPremiumMonthlyCents: null, olderFirmTaxes: older }).firmTaxes).toEqual({
      federalAnnualCents: 2_028_000,
      payrollAnnualCents: 1_100_000,
    });
    expect(salaryFigures({ paySchedule: "every-two-weeks", paycheck: { ...none, federalCents: 78_000 }, olderPremiumMonthlyCents: null, olderFirmTaxes: null }).firmTaxes).toEqual({
      federalAnnualCents: 2_028_000,
      payrollAnnualCents: null,
    });
  });

  test("an older yearly tax figure reads as before until a paycheck figure is typed", () => {
    const older = { federalAnnualCents: 1_200_000, payrollAnnualCents: null };
    expect(salaryFigures({ paySchedule: null, paycheck: null, olderPremiumMonthlyCents: null, olderFirmTaxes: older }).firmTaxes).toEqual(older);
  });

  test("nothing typed anywhere: the premium and both taxes are estimated", () => {
    expect(salaryFigures({ paySchedule: null, paycheck: null, olderPremiumMonthlyCents: null, olderFirmTaxes: null })).toEqual({ premiumMonthlyCents: null, firmTaxes: null });
    expect(salaryFigures({ paySchedule: "weekly", paycheck: none, olderPremiumMonthlyCents: null, olderFirmTaxes: null })).toEqual({ premiumMonthlyCents: null, firmTaxes: null });
  });

  test("the converted figures feed the existing yearly tax path and monthly premium path", () => {
    // Twice a month: federal $333.33 = $7,999.92 a year; Social Security and Medicare $300.00 = $7,200.00 a year;
    // premium $250.00 = $6,000.00 a year = $500.00 a month.
    const f = salaryFigures({ paySchedule: "twice-a-month", paycheck: { federalCents: 33_333, payrollCents: 30_000, premiumCents: 25_000 }, olderPremiumMonthlyCents: 45_000, olderFirmTaxes: null });
    expect(f).toEqual({ premiumMonthlyCents: 50_000, firmTaxes: { federalAnnualCents: 799_992, payrollAnnualCents: 720_000 } });
    const a: SalaryAssumptions = { premiumMonthlyCents: f.premiumMonthlyCents!, premiumFromSettings: true, firmTaxes: f.firmTaxes, maaserRate: 0.1, children: 1 };
    const b = currentSalaryBreakdown(9_600_000, 0, a);
    // $96,000 - $7,999.92 - $7,200.00 = $80,800.08 after tax; premium $6,000.00 a year.
    expect([b.federalAnnualCents, b.ficaAnnualCents, b.afterTaxAnnualCents, b.premiumAnnualCents]).toEqual([799_992, 720_000, 8_080_008, 600_000]);
  });
});

describe("what a save may carry", () => {
  const none = { federalCents: null, payrollCents: null, premiumCents: null };
  test("a known schedule with figures, or no figures at all, is fine", () => {
    expect(paycheckProblem("every-two-weeks", { federalCents: 78_000, payrollCents: 0, premiumCents: null })).toBeNull();
    expect(paycheckProblem(null, none)).toBeNull();
    expect(paycheckProblem(null, null)).toBeNull();
  });
  test("a figure with no schedule is refused in plain words", () => {
    expect(paycheckProblem(null, { ...none, premiumCents: 30_003 })).toBe("Pick how often you are paid before typing paycheck figures.");
  });
  test("an unknown schedule, a figure below zero, or a figure that is not a number is refused", () => {
    expect(paycheckProblem("fortnightly", none)).toBe("That pay schedule is not recognized.");
    expect(paycheckProblem("weekly", { ...none, federalCents: -1 })).toBe("A paycheck figure cannot be below zero.");
    expect(paycheckProblem("weekly", { ...none, payrollCents: "12" })).toBe("Type each paycheck figure as dollars, or leave it blank to estimate.");
    expect(paycheckProblem("weekly", "all of it")).toBe("Paycheck figures are not recognized.");
  });
});

describe("which figures on the screen are older ones, typed before paycheck figures existed", () => {
  test("older saved data: the premium is an older monthly figure; no older tax figure", () => {
    const a: SalaryAssumptions = { premiumMonthlyCents: 45_000, premiumFromSettings: true, firmTaxes: null, paySchedule: null, paycheck: null, maaserRate: 0.1, children: 1 };
    expect(olderFigures(a)).toEqual({ premium: true, federal: false, payroll: false });
  });
  test("a typed paycheck figure is a paycheck figure, not an older one; an estimate is neither", () => {
    const a: SalaryAssumptions = {
      premiumMonthlyCents: 65_007,
      premiumFromSettings: true,
      firmTaxes: { federalAnnualCents: 2_028_000, payrollAnnualCents: 1_100_000 },
      paySchedule: "every-two-weeks",
      paycheck: { federalCents: 78_000, payrollCents: null, premiumCents: 30_003 },
      maaserRate: 0.1,
      children: 1,
    };
    expect(olderFigures(a)).toEqual({ premium: false, federal: false, payroll: true });
    expect(olderFigures({ premiumMonthlyCents: 63_000, premiumFromSettings: false, maaserRate: 0.1, children: 1 })).toEqual({ premium: false, federal: false, payroll: false });
  });
});
