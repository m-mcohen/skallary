// @vitest-environment jsdom
// tests/ui/PaycheckFigures.test.tsx
//
// The charity amount is a tenth of pay into the bank (after tax and benefits); figures below re-worked by hand.
//
// On the screen: Settings, Salary takes the
// federal income tax, Social Security and Medicare, and the health premium PER PAYCHECK,
// as read off the pay stub, with how often pay arrives chosen once. Under each box: what it
// comes to a month and a year. The boxes wait for the schedule. The tax boxes go with a
// yearly base salary; the premium box is always there, because
// a typed premium applies to every salary. An older premium typed a month (for
// example $650.00) is said plainly, and typing the paycheck figure replaces it.
//
// The premium box became the Benefits list (tests/ui/BenefitsSettings.test.tsx).
// The premium cases here now read the list: a premium in force shows as one row named Benefits.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import CurrentSalaryCard from "../../src/ui/CurrentSalaryCard";
import SalaryAssumptionsCard from "../../src/ui/SalaryAssumptionsCard";
import type { Db } from "../../src/ui/lib/db";
import type { SalaryAssumptions } from "../../src/domain/salary";
import type { IncomeSettings } from "../../src/domain/income";

afterEach(cleanup);

const ESTIMATED: SalaryAssumptions = { premiumMonthlyCents: 63_000, premiumFromSettings: false, maaserRate: 0.1, children: 1, paySchedule: null, paycheck: null };
const current = { kind: "gross" as const, grossAnnualCents: 12_000_000, fromPeriod: "2026-11" };

function layer(stored: SalaryAssumptions) {
  const setIncome = vi.fn(async (_db: Db, _i: IncomeSettings) => {});
  return { setIncome, dataLayer: { loadDb: async () => ({}) as Db, getSalarySettings: async () => stored, setIncome } };
}
const box = (el: HTMLElement) => el as HTMLInputElement;

describe("the pay schedule and the three paycheck boxes", () => {
  test("four choices; the boxes wait for one, and say so", async () => {
    const { dataLayer } = layer({ ...ESTIMATED, currentSalary: current });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    for (const label of ["Weekly", "Every two weeks", "Twice a month", "Monthly"]) await r.findByText(label);
    expect(box(await r.findByLabelText("Federal income tax, a paycheck")).disabled).toBe(true);
    expect(box(r.getByLabelText("Social Security and Medicare, a paycheck")).disabled).toBe(true);
    r.getByText(/Pick how often you are paid first/);
    fireEvent.click(r.getByText("Every two weeks"));
    expect(box(r.getByLabelText("Federal income tax, a paycheck")).disabled).toBe(false);
    expect(r.queryByText(/Pick how often you are paid first/)).toBeNull();
  });

  test("$800.00 every two weeks comes to $1,733.33 a month and $20,800.00 a year, said under the box", async () => {
    const { dataLayer } = layer({ ...ESTIMATED, currentSalary: current });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    fireEvent.click(await r.findByText("Every two weeks"));
    fireEvent.change(r.getByLabelText("Federal income tax, a paycheck"), { target: { value: "800.00" } });
    // 80,000 x 26 = 2,080,000 = $20,800.00 a year; / 12 = $1,733.33 a month.
    expect(r.getByTestId("paycheck-hint-federal").textContent).toBe("Comes to $1,733.33 a month, $20,800.00 a year.");
    expect(r.getByTestId("paycheck-hint-payroll").textContent).toBe("Left blank: estimated.");
  });

  test("typed twice a month: the bank line uses them, and Save salary saves the schedule and the paycheck figures", async () => {
    const { setIncome, dataLayer } = layer({ ...ESTIMATED, currentSalary: current });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    fireEvent.click(await r.findByText("Twice a month"));
    fireEvent.change(r.getByLabelText("Federal income tax, a paycheck"), { target: { value: "333.33" } });
    fireEvent.change(r.getByLabelText("Social Security and Medicare, a paycheck"), { target: { value: "375" } });
    fireEvent.click(r.getByText("Add a benefit"));
    fireEvent.change(r.getByLabelText("Benefit 1 name"), { target: { value: "Health insurance" } });
    fireEvent.change(r.getByLabelText("Benefit 1 every"), { target: { value: "paycheck" } });
    fireEvent.change(r.getByLabelText("Benefit 1 amount"), { target: { value: "250.00" } });
    // 24 paychecks: federal $7,999.92 a year ($666.66 a month); Social Security and Medicare $9,000.00 ($750.00);
    // the benefit $6,000.00 a year ($500.00 a month).
    expect(r.getByTestId("paycheck-hint-federal").textContent).toBe("Comes to $666.66 a month, $7,999.92 a year.");
    expect(r.getByTestId("paycheck-hint-payroll").textContent).toBe("Comes to $750.00 a month, $9,000.00 a year.");
    expect(r.getByTestId("benefit-hint-1").textContent).toBe("Comes to $500.00 a month.");
    // $120,000 - $7,999.92 - $9,000.00 = $103,000.08 after tax; less the benefit $6,000.00 = $97,000.08;
    // / 12 = $8,083.34 reaches the bank. The charity amount, a tenth of the $97,000.08 into the bank:
    // $9,700.008 / 12 = $808.334 -> $808.33.
    await waitFor(() => expect(r.getByTestId("current-salary-bank").textContent).toMatch(/\$8,083\.34 a month/));
    expect(r.getByTestId("current-salary-bank").textContent).toMatch(/\$808\.33 a month/);
    expect(r.getByTestId("current-salary-bank").textContent).toMatch(/your firm figures/);
    fireEvent.click(r.getByText("Save salary"));
    await waitFor(() =>
      expect(setIncome).toHaveBeenCalledWith(expect.anything(), {
        currentSalary: current,
        additionalSalary: null,
        paySchedule: "twice-a-month",
        paycheck: { federalCents: 33_333, payrollCents: 37_500, premiumCents: null },
        benefits: [{ name: "Health insurance", amountCents: 25_000, every: "paycheck", beforeTax: true }],
      })
    );
    expect(setIncome.mock.calls[0][1]).not.toHaveProperty("firmTaxes");
  });

  test("saved paycheck figures load into their boxes with the schedule", async () => {
    const { dataLayer } = layer({
      ...ESTIMATED,
      currentSalary: current,
      paySchedule: "every-two-weeks",
      paycheck: { federalCents: 80_000, payrollCents: null, premiumCents: 30_000 },
      premiumMonthlyCents: 65_000,
      premiumFromSettings: true,
      firmTaxes: { federalAnnualCents: 2_080_000, payrollAnnualCents: null },
    });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    await waitFor(() => expect(box(r.getByLabelText("Federal income tax, a paycheck")).value).toBe("800.00"));
    expect(box(r.getByLabelText("Social Security and Medicare, a paycheck")).value).toBe("");
    // The paycheck premium in force is one row, named Benefits, typed a paycheck.
    expect(box(r.getByLabelText("Benefit 1 name")).value).toBe("Benefits");
    expect(box(r.getByLabelText("Benefit 1 amount")).value).toBe("300.00");
    // $300.00 x 26 = $7,800.00 a year; / 12 = $650.00 a month.
    expect(r.getByTestId("benefit-hint-1").textContent).toBe("Comes to $650.00 a month.");
  });

  test("a figure that is not dollars is refused in words, and nothing is saved", async () => {
    const { setIncome, dataLayer } = layer({ ...ESTIMATED, currentSalary: current });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    fireEvent.click(await r.findByText("Weekly"));
    fireEvent.change(r.getByLabelText("Federal income tax, a paycheck"), { target: { value: "abc" } });
    fireEvent.click(r.getByText("Save salary"));
    await r.findByText("Type each paycheck figure as dollars, or leave it blank to estimate.");
    expect(setIncome).not.toHaveBeenCalled();
  });

  test("a benefit that is not dollars is refused in words, and nothing is saved", async () => {
    const { setIncome, dataLayer } = layer({ ...ESTIMATED, currentSalary: current });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    fireEvent.click(await r.findByText("Add a benefit"));
    fireEvent.change(r.getByLabelText("Benefit 1 name"), { target: { value: "Dental" } });
    fireEvent.change(r.getByLabelText("Benefit 1 amount"), { target: { value: "abc" } });
    fireEvent.click(r.getByText("Save salary"));
    await r.findByText("Type each benefit as dollars, such as 500.00.");
    expect(setIncome).not.toHaveBeenCalled();
  });
});

describe("older figures, typed before paycheck figures existed", () => {
  test("the premium typed as $650.00 a month shows as one Benefits row, and a save without editing keeps it", async () => {
    const { setIncome, dataLayer } = layer({ ...ESTIMATED, premiumMonthlyCents: 65_000, premiumFromSettings: true });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    await waitFor(() => expect(box(r.getByLabelText("Benefit 1 amount")).value).toBe("650.00"));
    expect((r.getByLabelText("Benefit 1 every") as HTMLSelectElement).value).toBe("month");
    fireEvent.click(r.getByText("Save salary"));
    // No list sent: the server leaves the older monthly premium as it is.
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

  test("an older yearly tax figure is said plainly under its box", async () => {
    const { dataLayer } = layer({ ...ESTIMATED, currentSalary: current, firmTaxes: { federalAnnualCents: 1_200_000, payrollAnnualCents: null } });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    await waitFor(() =>
      expect(r.getByTestId("paycheck-hint-federal").textContent).toBe("Now $12,000.00 a year, typed earlier as a yearly amount. Type the paycheck figure to replace it.")
    );
    expect(r.getByTestId("paycheck-hint-payroll").textContent).toBe("Left blank: estimated.");
  });
});

// The grey text in a blank box said "Estimated" while the line under it said
// an older figure was in force. A blank box's grey text names what is in force: the older
// figure in the unit it was typed in, and "Estimated" only when nothing is stored. The line under
// each box stays as it was. Kept to the figure and its unit ("650.00 a month"): three boxes side by
// side from 640 px hold about 16 characters each, and the line under the box says "typed earlier".
describe("the grey text in a blank box", () => {
  test("the card's own sentence says a blank box keeps an earlier figure, not only that it estimates", async () => {
    const { dataLayer } = layer({ ...ESTIMATED, currentSalary: current });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    await r.findByLabelText("Federal income tax, a paycheck");
    expect(r.container.textContent).toContain("Leave a box blank to keep a figure typed earlier, or to estimate when there is none.");
    expect(r.container.textContent).not.toContain("Leave a box blank to estimate.");
  });

  test("with the older premium, $650.00 a month, in force, the tax boxes still say Estimated", async () => {
    const { dataLayer } = layer({ ...ESTIMATED, currentSalary: current, premiumMonthlyCents: 65_000, premiumFromSettings: true });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    await waitFor(() => expect(box(r.getByLabelText("Benefit 1 amount")).value).toBe("650.00"));
    expect(box(r.getByLabelText("Federal income tax, a paycheck")).placeholder).toBe("Estimated");
    expect(box(r.getByLabelText("Social Security and Medicare, a paycheck")).placeholder).toBe("Estimated");
  });

  test("nothing stored: every blank box says Estimated", async () => {
    const { dataLayer } = layer({ ...ESTIMATED, currentSalary: current });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    await r.findByLabelText("Federal income tax, a paycheck");
    for (const label of ["Federal income tax, a paycheck", "Social Security and Medicare, a paycheck"]) {
      expect(box(r.getByLabelText(label)).placeholder, label).toBe("Estimated");
    }
  });

  test("an older yearly tax figure is named in its box, a year; the other tax box says Estimated", async () => {
    const { dataLayer } = layer({ ...ESTIMATED, currentSalary: current, firmTaxes: { federalAnnualCents: null, payrollAnnualCents: 800_000 } });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    // 800,000 cents = $8,000.00 a year, written as it would be typed, without the dollar sign.
    await waitFor(() => expect(box(r.getByLabelText("Social Security and Medicare, a paycheck")).placeholder).toBe("8,000.00 a year"));
    expect(box(r.getByLabelText("Federal income tax, a paycheck")).placeholder).toBe("Estimated");
    expect(r.getByTestId("paycheck-hint-payroll").textContent).toBe("Now $8,000.00 a year, typed earlier as a yearly amount. Type the paycheck figure to replace it.");
  });

  test("once a paycheck premium replaces the older one, the Benefits row holds the paycheck figure", async () => {
    const { dataLayer } = layer({
      ...ESTIMATED,
      currentSalary: current,
      premiumMonthlyCents: 65_000,
      premiumFromSettings: true,
      paySchedule: "every-two-weeks",
      paycheck: { federalCents: null, payrollCents: null, premiumCents: 30_000 },
    });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    const amount = box(await r.findByLabelText("Benefit 1 amount"));
    await waitFor(() => expect(amount.value).toBe("300.00"));
    expect((r.getByLabelText("Benefit 1 every") as HTMLSelectElement).value).toBe("paycheck");
  });
});

describe("which boxes show", () => {
  test("with Monthly pay into the bank the tax boxes are gone, Benefits stays", async () => {
    const { dataLayer } = layer({ ...ESTIMATED, currentSalary: { kind: "take-home", monthlyCents: 900_000, fromPeriod: "2026-11" } });
    const r = render(<CurrentSalaryCard dataLayer={dataLayer} />);
    await r.findByText("Add a benefit");
    expect(r.queryByLabelText("Federal income tax, a paycheck")).toBeNull();
    expect(r.queryByLabelText("Social Security and Medicare, a paycheck")).toBeNull();
    r.getByText(/Tax figures from the pay stub go with a yearly base salary/);
  });

  test("Salary assumptions no longer has a premium box, and its Save leaves the premium alone", async () => {
    const setTaxProfile = vi.fn(async () => {});
    const r = render(
      <SalaryAssumptionsCard dataLayer={{ loadDb: async () => ({}) as Db, getSalarySettings: async () => ({ ...ESTIMATED, premiumMonthlyCents: 65_000, premiumFromSettings: true, tax: { filingStatus: "mfj", children: 1 } }), setTaxProfile }} />
    );
    fireEvent.change(await r.findByLabelText("Number of children"), { target: { value: "2" } });
    expect(r.queryByLabelText(/Health premium/)).toBeNull();
    r.getByText(/Benefits are typed under Current salary/);
    fireEvent.click(r.getByText("Save"));
    await waitFor(() => expect(setTaxProfile).toHaveBeenCalledWith({ filingStatus: "mfj", children: 2 }));
  });
});
