// @vitest-environment jsdom
// tests/ui/BenefitsSettings.test.tsx
//
// Benefits on Settings, Salary: one row per benefit paid for, a paycheck or a month, Before
// tax ticked unless it is unticked, in place of the single Health premium box. With no list
// saved the figure in force shows as one row named Benefits and nothing about it is saved
// until a row is edited, so no figure moves.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import CurrentSalaryCard from "../../src/ui/CurrentSalaryCard";
import type { Db } from "../../src/ui/lib/db";
import type { SalaryAssumptions } from "../../src/domain/salary";
import type { IncomeSettings } from "../../src/domain/income";

afterEach(cleanup);

const current = { kind: "gross" as const, grossAnnualCents: 15_000_000, fromPeriod: "2026-11" };
const BASE: SalaryAssumptions = { premiumMonthlyCents: 63_000, premiumFromSettings: false, maaserRate: 0.1, children: 1, paySchedule: null, paycheck: null, currentSalary: current };

function layer(stored: SalaryAssumptions) {
  const setIncome = vi.fn(async (_db: Db, _i: IncomeSettings) => {});
  return { setIncome, dataLayer: { loadDb: async () => ({}) as Db, getSalarySettings: async () => stored, setIncome } };
}
const input = (el: HTMLElement) => el as HTMLInputElement;
const lastSaved = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[fn.mock.calls.length - 1][1] as IncomeSettings;

describe("Benefits on Settings, Salary", () => {
  test("the Health premium box is gone", async () => {
    const r = render(<CurrentSalaryCard dataLayer={layer(BASE).dataLayer} />);
    await r.findByText("Benefits");
    expect(r.queryByLabelText(/Health premium/)).toBeNull();
  });

  test("none typed: it says the estimate, and Save salary sends no list", async () => {
    const { dataLayer, setIncome } = layer(BASE);
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    expect((await r.findByTestId("benefits-none")).textContent).toBe("None typed: no benefits come out of pay.");
    fireEvent.click(r.getByText("Save salary"));
    await waitFor(() => expect(setIncome).toHaveBeenCalled());
    expect("benefits" in lastSaved(setIncome)).toBe(false);
  });

  test("an older monthly premium shows as one row named Benefits, and an untouched save sends no list", async () => {
    const { dataLayer, setIncome } = layer({ ...BASE, premiumMonthlyCents: 120_000, premiumFromSettings: true });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    expect(input(await r.findByLabelText("Benefit 1 name")).value).toBe("Benefits");
    expect(input(r.getByLabelText("Benefit 1 amount")).value).toBe("1,200.00");
    expect((r.getByLabelText("Benefit 1 every") as HTMLSelectElement).value).toBe("month");
    expect(r.queryByLabelText("Benefit 2 name")).toBeNull();
    fireEvent.click(r.getByText("Save salary"));
    await waitFor(() => expect(setIncome).toHaveBeenCalled());
    expect("benefits" in lastSaved(setIncome)).toBe(false);
  });

  test("a user adds rows, unticks one as after tax, and Save salary sends the list as typed", async () => {
    const { dataLayer, setIncome } = layer({ ...BASE, premiumMonthlyCents: 90_000, premiumFromSettings: true });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    fireEvent.change(await r.findByLabelText("Benefit 1 name"), { target: { value: "Health insurance" } });
    fireEvent.change(r.getByLabelText("Benefit 1 amount"), { target: { value: "500.00" } });
    fireEvent.click(r.getByText("Add a benefit"));
    fireEvent.change(r.getByLabelText("Benefit 2 name"), { target: { value: "Life insurance" } });
    fireEvent.change(r.getByLabelText("Benefit 2 amount"), { target: { value: "25" } });
    fireEvent.click(r.getByLabelText("Benefit 2 before tax"));
    expect(r.getByTestId("benefits-total").textContent).toBe("In all $525.00 a month ($6,300.00 a year), $500.00 of it before tax.");
    fireEvent.click(r.getByText("Save salary"));
    await waitFor(() => expect(setIncome).toHaveBeenCalled());
    expect(lastSaved(setIncome).benefits).toEqual([
      { name: "Health insurance", amountCents: 50_000, every: "month", beforeTax: true },
      { name: "Life insurance", amountCents: 2_500, every: "month", beforeTax: false },
    ]);
  });

  test("a saved list loads as typed; removing every row saves an empty list", async () => {
    const list = [
      { name: "Health insurance", amountCents: 50_000, every: "month" as const, beforeTax: true },
      { name: "HSA", amountCents: 40_000, every: "month" as const, beforeTax: true },
    ];
    const { dataLayer, setIncome } = layer({ ...BASE, premiumMonthlyCents: 90_000, premiumFromSettings: true, benefits: list });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    expect(input(await r.findByLabelText("Benefit 2 name")).value).toBe("HSA");
    expect(input(r.getByLabelText("Benefit 2 amount")).value).toBe("400.00");
    fireEvent.click(r.getByLabelText("Remove benefit 2"));
    fireEvent.click(r.getByLabelText("Remove benefit 1"));
    fireEvent.click(r.getByText("Save salary"));
    await waitFor(() => expect(setIncome).toHaveBeenCalled());
    expect(lastSaved(setIncome).benefits).toEqual([]);
  });

  test("a row typed a paycheck says what it comes to a month by the schedule, and waits for one", async () => {
    const { dataLayer } = layer({ ...BASE, premiumMonthlyCents: 90_000, premiumFromSettings: true });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    fireEvent.change(await r.findByLabelText("Benefit 1 every"), { target: { value: "paycheck" } });
    fireEvent.change(r.getByLabelText("Benefit 1 amount"), { target: { value: "100.00" } });
    expect(r.getByTestId("benefit-hint-1").textContent).toBe("Pick how often you are paid above first.");
    fireEvent.click(r.getByText("Twice a month"));
    expect(r.getByTestId("benefit-hint-1").textContent).toBe("Comes to $200.00 a month.");
  });

  test("a row with no name is refused in plain words, and nothing is saved", async () => {
    const { dataLayer, setIncome } = layer({ ...BASE, premiumMonthlyCents: 90_000, premiumFromSettings: true });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    fireEvent.change(await r.findByLabelText("Benefit 1 name"), { target: { value: " " } });
    fireEvent.click(r.getByText("Save salary"));
    await r.findByText("Give each benefit a name.");
    expect(setIncome).not.toHaveBeenCalled();
  });

  test("the bank line counts the benefits as typed, before tax and after", async () => {
    const { dataLayer } = layer({ ...BASE, premiumMonthlyCents: 90_000, premiumFromSettings: true });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    await r.findByLabelText("Benefit 1 amount");
    const bankAt = () => r.getByTestId("current-salary-bank").textContent!;
    const before = bankAt();
    // Untick before tax: the same money comes out, but more of the wages are taxed, so less reaches the bank.
    fireEvent.click(r.getByLabelText("Benefit 1 before tax"));
    expect(bankAt()).not.toBe(before);
    expect(bankAt()).toMatch(/^After tax and benefits, about/);
  });
});
