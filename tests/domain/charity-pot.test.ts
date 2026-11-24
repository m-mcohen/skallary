// tests/domain/charity-pot.test.ts -- the charity pot: what it owes over a span and a month, that a
// percent pot gives the same cents as the single rate it replaces, whose accounts count, and a ledger
// with no pot account. Values invented.
import { describe, expect, test } from "vitest";
import { potMonthCents, potOwedCents, type CharityPot } from "../../src/domain/charity-pot";
import { monthlyPayCents, type SalaryAssumptions, type SalaryBreakdown } from "../../src/domain/salary";
import { forecastEarners, monthIncome } from "../../src/domain/cash-forecast";
import { maaserLedgerView, maaserRole } from "../../src/domain/maaser-pot";
import { maaserShortfallCents, type WhatIf } from "../../src/domain/what-if";
import { ACCOUNT_IDS } from "../../demo/household";
import { demoAccounts, demoSalary, demoTransactions } from "../demo";

const base: CharityPot = {
  on: true, name: "Giving", kind: "percent", rateBps: 500, fixedCents: null, fixedFrom: null,
  counts: { me: true, partner: true, joint: true }, floorCents: 0,
};

test("a percent pot owes its rate of counted income", () => {
  expect(potOwedCents(base, 1_000_000, "2026-01", "2026-12")).toBe(50_000);
});

test("a monthly pot owes from the month it was switched on", () => {
  const p = { ...base, kind: "monthly" as const, rateBps: null, fixedCents: 10_000, fixedFrom: "2026-04" };
  expect(potOwedCents(p, 0, "2026-01", "2026-12")).toBe(90_000);
});

test("twelve monthly shares of a yearly pot add up to it exactly, across a year end", () => {
  const p = { ...base, kind: "yearly" as const, rateBps: null, fixedCents: 100_001, fixedFrom: "2026-07" };
  const months = ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"];
  expect(months.reduce((s, m) => s + potMonthCents(p, m, 0), 0)).toBe(100_001);
  expect(potOwedCents(p, 0, "2026-01", "2026-12") + potOwedCents(p, 0, "2027-01", "2027-06")).toBe(100_001);
});

test("a percent pot's month equals today's charity figure to the cent", () => {
  // A rounded breakdown where 10% of the rounded paycheck gives 10_289, and a base with the
  // additional monthly amount added gives 10_788; the pot's month is 10_288.
  const b: SalaryBreakdown = {
    grossAnnualCents: 2_000_000, ficaAnnualCents: 153_000, federalAnnualCents: 512_386, afterTaxAnnualCents: 1_334_614,
    charityAnnualCents: 0, premiumAnnualCents: 100_000, takeHomeAnnualCents: 0, otherGrossAnnualCents: 0, otherNetAnnualCents: 60_000,
  };
  const a: SalaryAssumptions = { ...demoSalary(), maaserRate: 0.1 };
  const p = { ...base, rateBps: 1000 };
  expect(potMonthCents(p, "2026-05", b.afterTaxAnnualCents - b.premiumAnnualCents)).toBe(monthlyPayCents(b, a).maaserCents);
  expect(potMonthCents(p, "2026-05", b.afterTaxAnnualCents - b.premiumAnnualCents)).toBe(10_288);
  // The Forecast's month through the pot path equals the month through the single rate.
  const earners = forecastEarners(a, null, "2026-05");
  expect(monthIncome("2026-05", earners, { ...a, pot: p }).maaserCents).toBe(monthIncome("2026-05", earners, a).maaserCents);
});

test("with the partner switch on, pay into the partner's account counts toward a percent pot", () => {
  const accounts = demoAccounts();
  // A pay row moved onto the partner's own account (invented for the test).
  const pay = demoTransactions().find((t) => t.sourceCategory === "Paychecks")!;
  const samPayRow = { ...pay, accountId: ACCOUNT_IDS.samCard };
  expect(maaserRole(samPayRow, accounts, {}, base)).toBe("income");
  expect(maaserRole(samPayRow, accounts, {}, { ...base, counts: { me: true, partner: false, joint: false } })).toBeNull();
});

test("a ledger with no pot account shows owed against given and no balance", () => {
  const accountsWithoutPot = demoAccounts().map((a) => ({ ...a, maaserPot: false }));
  const v = maaserLedgerView({
    prepared: demoTransactions(), accounts: accountsWithoutPot, mapping: {}, marks: [], maaserRate: 0,
    pot: base, floorCents: 0, from: "2025-01-01", to: "2027-12-31",
  });
  expect(v?.account).toBeNull();
  expect(v?.balanceCents).toBeNull();
  expect(v?.ledger.owedCents).toBeGreaterThan(0);
});

describe("a what-if raises the Charity line by a set-amount pot's own month", () => {
  const w: WhatIf = { scenarioId: "w", salaryGrossAnnualCents: 9_000_000, salaryFromPeriod: "2026-01", changes: [], rows: [] };
  test("a yearly pot's twelve raises add up to it exactly", () => {
    const a = { ...demoSalary(), pot: { ...base, kind: "yearly" as const, rateBps: null, fixedCents: 120_005, fixedFrom: "2026-11" } };
    const months = ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10"];
    expect(months.reduce((s, m) => s + maaserShortfallCents(w, [], m, a), 0)).toBe(120_005);
  });
  test("a monthly pot raises nothing before its start month", () => {
    const a = { ...demoSalary(), pot: { ...base, kind: "monthly" as const, rateBps: null, fixedCents: 25_000, fixedFrom: "2030-01" } };
    expect(maaserShortfallCents(w, [], "2026-06", a)).toBe(0);
    expect(maaserShortfallCents(w, [], "2030-01", a)).toBe(25_000);
  });
});
