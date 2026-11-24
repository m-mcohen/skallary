// @vitest-environment jsdom
// tests/ui/CurrentSalaryCard-reread.test.tsx
//
// After Save salary the card once kept
// the settings it read on mount, so its bank line could use an older premium the save had just
// replaced. After a save that works, the card reads the salary settings again (the same read
// it does on mount), so the bank line works from what is now in force.
//
// The premium is the list of benefits typed in; the data layer
// below stands in for the server: a saved list is the premium, its total a month, as the
// server's read makes it (benefitsTotals).
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import CurrentSalaryCard from "../../src/ui/CurrentSalaryCard";
import type { Db } from "../../src/ui/lib/db";
import type { SalaryAssumptions } from "../../src/domain/salary";
import type { IncomeSettings } from "../../src/domain/income";
import { benefitsTotals } from "../../src/domain/benefits";

afterEach(cleanup);

const current = { kind: "gross" as const, grossAnnualCents: 12_000_000, fromPeriod: "2026-11" };

function fakeServer() {
  // An older premium typed as $1,000.00 a month, no charity share, $120,000 a year.
  let stored: SalaryAssumptions = {
    premiumMonthlyCents: 100_000,
    premiumFromSettings: true,
    firmTaxes: null,
    paySchedule: null,
    paycheck: null,
    maaserRate: 0,
    children: 1,
    currentSalary: current,
    additionalSalary: null,
  };
  const getSalarySettings = vi.fn(async () => stored);
  const setIncome = vi.fn(async (_db: Db, i: IncomeSettings) => {
    const paySchedule = i.paySchedule ?? null;
    const t = i.benefits ? benefitsTotals(i.benefits, paySchedule) : null;
    stored = {
      ...stored,
      currentSalary: i.currentSalary,
      additionalSalary: i.additionalSalary,
      paySchedule,
      paycheck: i.paycheck ?? null,
      // Firm taxes of $0.00 keep the arithmetic plain: no tax at all.
      firmTaxes: { federalAnnualCents: 0, payrollAnnualCents: 0 },
      ...(t ? { benefits: i.benefits, premiumMonthlyCents: t.monthlyCents, afterTaxBenefitsMonthlyCents: t.afterTaxMonthlyCents } : {}),
    };
  });
  return { getSalarySettings, setIncome, dataLayer: { loadDb: async () => ({}) as Db, getSalarySettings, setIncome } };
}

describe("after Save salary the bank line works from the settings now in force", () => {
  test("$200 a month replaces the older $1,000; removing every benefit and saving again means none at all", async () => {
    const { getSalarySettings, setIncome, dataLayer } = fakeServer();
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    fireEvent.click(await r.findByText("Monthly"));
    fireEvent.change(r.getByLabelText("Federal income tax, a paycheck"), { target: { value: "0" } });
    fireEvent.change(r.getByLabelText("Social Security and Medicare, a paycheck"), { target: { value: "0" } });
    fireEvent.change(r.getByLabelText("Benefit 1 amount"), { target: { value: "200" } });
    // ($120,000.00 - $200.00 x 12 = $2,400.00) / 12 = $9,800.00 a month.
    await waitFor(() => expect(r.getByTestId("current-salary-bank").textContent).toMatch(/\$9,800\.00 a month/));
    fireEvent.click(r.getByText("Save salary"));
    await r.findByText("Saved.");
    expect(setIncome).toHaveBeenCalledTimes(1);

    // Remove the benefit and save again, without leaving the page.
    fireEvent.click(r.getByLabelText("Remove benefit 1"));
    fireEvent.click(r.getByText("Save salary"));
    await waitFor(() => expect(setIncome).toHaveBeenCalledTimes(2));
    expect(setIncome.mock.calls[1][1].benefits).toEqual([]);
    // In force now: no benefits. $120,000.00 / 12 = $10,000.00 a month.
    await waitFor(() => expect(r.getByTestId("current-salary-bank").textContent).toMatch(/\$10,000\.00 a month/));
    expect(r.getByTestId("benefits-none")).toBeTruthy();
    // The card read the settings once on mount and once after each save.
    expect(getSalarySettings).toHaveBeenCalledTimes(3);
  });

  test("a refused save does not read again, and the rows keep what was typed", async () => {
    const { getSalarySettings, dataLayer } = fakeServer();
    const r = render(<CurrentSalaryCard dataLayer={{ ...dataLayer, setIncome: async () => { throw new Error("Refused."); } }} />);
    fireEvent.change(await r.findByLabelText("Benefit 1 amount"), { target: { value: "200" } });
    fireEvent.click(r.getByText("Save salary"));
    await r.findByText("Refused.");
    expect(getSalarySettings).toHaveBeenCalledTimes(1);
    expect((r.getByLabelText("Benefit 1 amount") as HTMLInputElement).value).toBe("200");
  });
});
