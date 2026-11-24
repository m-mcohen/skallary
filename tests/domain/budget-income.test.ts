import { expect, test } from "vitest";
import { lineBudget, PAYCHECKS_LINE, salaryCovers, settingsMoneyIn, sideOf } from "../../src/domain/budget-income";
import { monthIncome, forecastEarners } from "../../src/domain/cash-forecast";
import type { SalaryAssumptions } from "../../src/domain/salary";
import { demoSalary } from "../demo";
import type { BigMonth, BudgetChange, BudgetLine } from "../../src/domain/plan-types";

const P = "plan-2026";
const salary: SalaryAssumptions = { ...demoSalary(), currentSalary: { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "2026-11" } };
const line = (cat: string, amountCents: number, source: "you" | "suggested" = "suggested"): BudgetLine => ({ planId: P, planningCategory: cat, period: null, amountCents, source });
const big = (cat: string, month: string, amountCents: number): BigMonth => ({ id: 1, planId: P, planningCategory: cat, month, label: "Trip", amountCents, createdAt: "" });
const none = { changes: [] as BudgetChange[], bigMonths: [] as BigMonth[] };

test("sides: income and investment income read as income; saving lines are left out", () => {
  expect(sideOf("Paychecks")).toBe("income");
  expect(sideOf("Interest")).toBe("income");
  expect(sideOf("Groceries")).toBe("spending");
  expect(sideOf("Investing")).toBeNull();
});

test("Paychecks reads the money in from Settings, Salary; before the salary starts it has none", () => {
  expect(salaryCovers(salary, "2026-10")).toBe(false);
  expect(salaryCovers(salary, "2026-11")).toBe(true);
  expect(settingsMoneyIn(salary, "2026-10")).toEqual({ paycheckCents: null, maaserCents: 0 });
  const nov = monthIncome("2026-11", forecastEarners(salary, null, "2026-11"), salary);
  expect(settingsMoneyIn(salary, "2026-11")).toEqual({ paycheckCents: nov.bankCents, maaserCents: nov.maaserCents });
  const input = { ...none, lines: [line(PAYCHECKS_LINE, 99999)], salary };
  expect(lineBudget(input, PAYCHECKS_LINE, "income", "2026-10")).toEqual({ cents: null, from: "none", bigMonthCents: 0 });
  expect(lineBudget(input, PAYCHECKS_LINE, "income", "2026-11")).toEqual({ cents: nov.bankCents, from: "settings", bigMonthCents: 0 });
});

test("Charity reads the larger of its amount and the pot's amount from Settings", () => {
  const maaser = settingsMoneyIn(salary, "2026-11").maaserCents;
  expect(maaser).toBeGreaterThan(5000);
  const input = { ...none, lines: [line("Charity", 5000)], salary };
  expect(lineBudget(input, "Charity", "spending", "2026-10")).toEqual({ cents: 5000, from: "budget", bigMonthCents: 0 });
  expect(lineBudget(input, "Charity", "spending", "2026-11")).toEqual({ cents: maaser, from: "maaser", bigMonthCents: 0 });
});

test("a big month adds to its line in its month only", () => {
  const input = { changes: [], bigMonths: [big("Gifts", "2026-12", 40000)], lines: [line("Gifts", 10000)], salary };
  expect(lineBudget(input, "Gifts", "spending", "2026-11")).toEqual({ cents: 10000, from: "budget", bigMonthCents: 0 });
  expect(lineBudget(input, "Gifts", "spending", "2026-12")).toEqual({ cents: 50000, from: "budget", bigMonthCents: 40000 });
});

test("a line with no budget row has none; an income line cleared to zero has none", () => {
  const input = { ...none, lines: [line("Business Income", 0)], salary };
  expect(lineBudget(input, "Clothing", "spending", "2026-10")).toEqual({ cents: null, from: "none", bigMonthCents: 0 });
  expect(lineBudget(input, "Business Income", "income", "2026-10")).toEqual({ cents: null, from: "none", bigMonthCents: 0 });
  const set = { ...none, lines: [line("Business Income", 0, "you")], salary };
  expect(lineBudget(set, "Business Income", "income", "2026-10")).toEqual({ cents: 0, from: "budget", bigMonthCents: 0 });
});

// With no Charity row, Charity still reads the pot's amount from Settings.
test("Charity with no budget row still reads the pot's amount", () => {
  const maaser = settingsMoneyIn(salary, "2026-11").maaserCents;
  const input = { ...none, lines: [line("Groceries", 1000)], salary };
  expect(lineBudget(input, "Charity", "spending", "2026-11")).toEqual({ cents: maaser, from: "maaser", bigMonthCents: 0 });
  expect(lineBudget(input, "Charity", "spending", "2026-10")).toEqual({ cents: null, from: "none", bigMonthCents: 0 });
});
