// @vitest-environment jsdom
// tests/ui/CurrentSalaryCard-no-tax.test.tsx
//
// With the tax step skipped (no filing status, no children), Settings, Salary shows what was typed
// from the pay stub, but anything that needs an estimated federal tax waits: the set-this-up card
// stands where the bank line would be, never a guessed figure. Once both tax figures are typed,
// nothing is estimated and the bank line shows.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CurrentSalaryCard from "../../src/ui/CurrentSalaryCard";
import type { Db } from "../../src/ui/lib/db";
import type { SalaryAssumptions } from "../../src/domain/salary";
import { formatCents } from "../../src/domain/money";
import { demoSalary } from "../demo";

afterEach(cleanup);

test("typed federal and payroll figures show while the estimated lines wait for the tax step", async () => {
  // $400.00 federal a paycheck, twice a month: $9,600.00 a year. Social Security and Medicare left blank.
  const typedFederalAnnual = 40_000 * 24;
  const stored: SalaryAssumptions = {
    ...demoSalary(),
    tax: { filingStatus: null, children: null },
    children: 0,
    paySchedule: "twice-a-month",
    paycheck: { federalCents: 40_000, payrollCents: null, premiumCents: null },
    firmTaxes: { federalAnnualCents: typedFederalAnnual, payrollAnnualCents: null },
  };
  const dataLayer = { loadDb: async () => ({}) as Db, getSalarySettings: async () => stored, setIncome: vi.fn(async () => {}) };
  render(<CurrentSalaryCard dataLayer={dataLayer} />);
  expect((await screen.findByTestId("paycheck-hint-federal")).textContent).toContain(formatCents(typedFederalAnnual));
  expect(screen.getByRole("link", { name: /set this up/i }).getAttribute("href")).toBe("#/setup/tax");
  expect(screen.queryByTestId("current-salary-bank")).toBeNull();
  // Both tax figures typed: no estimate is left, so the bank line shows and the card goes.
  fireEvent.change(screen.getByLabelText("Social Security and Medicare, a paycheck"), { target: { value: "300" } });
  expect(screen.getByTestId("current-salary-bank").textContent).toMatch(/reaches the bank/);
  expect(screen.queryByRole("link", { name: /set this up/i })).toBeNull();
});
