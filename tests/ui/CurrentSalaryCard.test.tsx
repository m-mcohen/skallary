// @vitest-environment jsdom
//
// The charity pot is a tenth of pay into the bank (after tax and benefits); figures below re-worked by hand.
//
// Settings, Salary
// holds the current salary (a yearly base salary with a start month, or the
// monthly amount that hits the bank) and an optional additional salary (a W-2
// salary taxed jointly, or a monthly amount with no tax math).
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import CurrentSalaryCard from "../../src/ui/CurrentSalaryCard";
import type { Db } from "../../src/ui/lib/db";
import type { SalaryAssumptions } from "../../src/domain/salary";
import type { IncomeSettings } from "../../src/domain/income";

afterEach(cleanup);

const BASE: SalaryAssumptions = { premiumMonthlyCents: 50_000, maaserRate: 0.1, children: 1 };

function layer(stored: SalaryAssumptions) {
  const setIncome = vi.fn(async (_db: Db, _i: IncomeSettings) => {});
  return { setIncome, dataLayer: { loadDb: async () => ({}) as Db, getSalarySettings: async () => stored, setIncome } };
}

test("enters a yearly base salary and a W-2 additional salary, and saves both", async () => {
  const { setIncome, dataLayer } = layer(BASE);
  const onChanged = vi.fn();
  const { findByText, getByText, getByLabelText } = render(<CurrentSalaryCard dataLayer={dataLayer} onChanged={onChanged} />);
  fireEvent.click(await findByText("Yearly base salary"));
  fireEvent.change(getByLabelText("Yearly base salary, before tax"), { target: { value: "120,000" } });
  fireEvent.change(getByLabelText("Salary starts"), { target: { value: "2026-11" } });
  fireEvent.click(getByText("W-2 salary, taxed with yours"));
  fireEvent.change(getByLabelText("Additional yearly salary, before tax"), { target: { value: "50000" } });
  fireEvent.change(getByLabelText("Additional salary starts"), { target: { value: "2027-01" } });
  fireEvent.click(getByText("Save salary"));
  await waitFor(() =>
    expect(setIncome).toHaveBeenCalledWith(expect.anything(), {
      currentSalary: { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "2026-11" },
      additionalSalary: { kind: "w2", grossAnnualCents: 5_000_000, fromPeriod: "2027-01" },
      // No pay schedule and no paycheck figure typed, so the taxes and the
      // premium are estimated (the yearly firm-tax boxes became paycheck boxes).
      paySchedule: null,
      paycheck: { federalCents: null, payrollCents: null, premiumCents: null },
    })
  );
  expect(onChanged).toHaveBeenCalled();
});

test("shows what a yearly base salary leaves in the bank each month, worked the way the ladder works", async () => {
  const { dataLayer } = layer({ ...BASE, currentSalary: { kind: "gross", grossAnnualCents: 13_000_000, fromPeriod: "2026-11" } });
  const { findByTestId } = render(<CurrentSalaryCard dataLayer={dataLayer} />);
  // A $130,000 salary with a $500 premium. Hand check: 124,000 taxed wages, less 9,486 payroll
  // tax and 8,320 federal tax, is 106,194 a year; over 12 months, $8,849.50 reaches the bank;
  // the charity pot is a tenth of it ($884.95, whole cents).
  const line = await findByTestId("current-salary-bank");
  await waitFor(() => expect(line.textContent).toMatch(/\$8,849\.50 a month/));
  expect(line.textContent).toMatch(/\$884\.95 a month/);
});

test("loads a saved monthly take-home into its own box", async () => {
  const { dataLayer } = layer({ ...BASE, currentSalary: { kind: "take-home", monthlyCents: 900_000, fromPeriod: "2026-11" } });
  const { findByLabelText } = render(<CurrentSalaryCard dataLayer={dataLayer} />);
  const box = (await findByLabelText("Monthly pay, the amount that hits the bank")) as HTMLInputElement;
  await waitFor(() => expect(box.value).toBe("9,000.00"));
});

test("a salary with no start month is caught before saving, in words", async () => {
  const { setIncome, dataLayer } = layer(BASE);
  const { findByText, getByText, getByLabelText } = render(<CurrentSalaryCard dataLayer={dataLayer} />);
  fireEvent.click(await findByText("Monthly pay into the bank"));
  fireEvent.change(getByLabelText("Monthly pay, the amount that hits the bank"), { target: { value: "9000" } });
  fireEvent.click(getByText("Save salary"));
  await findByText("Pick the month your salary starts.");
  expect(setIncome).not.toHaveBeenCalled();
});

test("None clears both", async () => {
  const { setIncome, dataLayer } = layer({ ...BASE, currentSalary: { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "2026-11" } });
  const { findByLabelText, getAllByText, getByText } = render(<CurrentSalaryCard dataLayer={dataLayer} />);
  await findByLabelText("Yearly base salary, before tax");
  fireEvent.click(getAllByText("None")[0]);
  fireEvent.click(getByText("Save salary"));
  // With no yearly salary there are no firm tax figures either.
  // Nor paycheck tax figures; no schedule or premium was typed.
  await waitFor(() =>
    expect(setIncome).toHaveBeenCalledWith(expect.anything(), {
      currentSalary: null,
      additionalSalary: null,
      firmTaxes: { federalAnnualCents: null, payrollAnnualCents: null },
      paySchedule: null,
      paycheck: { federalCents: null, payrollCents: null, premiumCents: null },
    })
  );
});
