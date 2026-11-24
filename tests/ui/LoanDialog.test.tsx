// @vitest-environment jsdom
// tests/ui/LoanDialog.test.tsx
// The car and mortgage calculator. The payment uses the standard loan formula
// (src/domain/loan.ts); the down payment is paid once.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LoanDialog from "../../src/ui/what-if/LoanDialog";
import { loanMonthlyCents } from "../../src/domain/what-if";
import { formatCents } from "../../src/domain/money";

afterEach(cleanup);

const open = (kind: "car" | "mortgage", onSave = vi.fn(), editing = null as never) =>
  render(<LoanDialog open onOpenChange={() => {}} kind={kind} editing={editing} defaultFrom="2027-03" onSave={onSave} />);

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Car", () => {
  test("shows the payment a month as you type, and the down payment once", () => {
    open("car");
    type("Price", "30,000");
    type("Down payment", "5,000");
    type("Rate (percent a year)", "6.5");
    type("Years", "5");
    const car = { priceCents: 3_000_000, downPaymentCents: 500_000, annualRate: 0.065, years: 5 };
    expect(screen.getByTestId("loan-monthly").textContent).toBe(`About ${formatCents(loanMonthlyCents(car))} a month`);
    // No first-payment month; the Forecast takes the down payment when the what-if's costs begin.
    expect(screen.getByTestId("loan-down").textContent).toBe(
      "Down payment $5,000.00, paid once. It never counts toward a salary; the Forecast takes it in the month this what-if's costs begin."
    );
    expect(screen.queryByLabelText("First payment")).toBeNull();
  });

  // The months are stored, never read; the Forecast runs a car's payments for its
  // years from the what-if's cost start (datedChange), so nothing is worked out here.
  test("Use this hands back a car change with the loan; its months are stored as next month and open", () => {
    const onSave = vi.fn();
    open("car", onSave);
    type("Price", "30000");
    type("Down payment", "5000");
    type("Rate (percent a year)", "6.5");
    type("Years", "5");
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    const loan = { priceCents: 3_000_000, downPaymentCents: 500_000, annualRate: 0.065, years: 5 };
    expect(onSave).toHaveBeenCalledWith({
      kind: "car", label: "New car", planningCategory: "Car payment", amountCents: loanMonthlyCents(loan),
      fromPeriod: "2027-03", untilPeriod: null, loan,
    });
  });

  test("an impossible loan is refused in words and Use this is off", () => {
    const onSave = vi.fn();
    open("car", onSave);
    type("Price", "10,000");
    type("Down payment", "12,000");
    type("Rate (percent a year)", "6.5");
    type("Years", "5");
    expect(screen.getByRole("alert").textContent).toBe("The down payment is more than the price.");
    expect((screen.getByRole("button", { name: "Use this" }) as HTMLButtonElement).disabled).toBe(true);
    type("Down payment", "0");
    type("Years", "0");
    expect(screen.getByRole("alert").textContent).toBe("A loan needs at least one year.");
  });

  // Use this used to sit disabled with no explanation
  // while a required box was still blank.
  test("says what it is waiting for while Use this is off, with nothing else typed yet", () => {
    open("car");
    expect(screen.getByTestId("loan-waiting").textContent).toBe("Type the price, the rate and the years to see the payment.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "Use this" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("names only what is still missing, in the plan's own example wording", () => {
    open("car");
    type("Price", "35,000");
    expect(screen.getByTestId("loan-waiting").textContent).toBe("Type the rate and the years to see the payment.");
    type("Rate (percent a year)", "6.5");
    expect(screen.getByTestId("loan-waiting").textContent).toBe("Type the years to see the payment.");
    type("Years", "5");
    expect(screen.queryByTestId("loan-waiting")).toBeNull(); // now complete: the payment shows instead
    expect(screen.getByTestId("loan-monthly")).toBeTruthy();
  });

  test("editing a car opens with its numbers", () => {
    const editing = {
      id: "c1", position: 1, kind: "car", label: "Vehicle", planningCategory: "Car payment", amountCents: 1, fromPeriod: "2027-06", untilPeriod: "2032-05",
      loan: { priceCents: 3_000_000, downPaymentCents: 500_000, annualRate: 0.065, years: 5 },
    };
    open("car", vi.fn(), editing as never);
    expect((screen.getByLabelText("Price") as HTMLInputElement).value).toBe("30,000.00");
    expect((screen.getByLabelText("Rate (percent a year)") as HTMLInputElement).value).toBe("6.5");
    expect((screen.getByLabelText("Name of the change") as HTMLInputElement).value).toBe("Vehicle");
  });
});

describe("While saving", () => {
  test("Use this is off while a save is running, and a refusal shows in the dialog", () => {
    render(<LoanDialog open onOpenChange={() => {}} kind="car" editing={null} defaultFrom="2027-03" onSave={vi.fn()} busy saveError="The app could not be reached." />);
    type("Price", "30000");
    type("Rate (percent a year)", "6.5");
    type("Years", "5");
    expect((screen.getByRole("button", { name: "Use this" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Not saved: The app could not be reached.")).toBeTruthy();
  });
});

describe("Mortgage", () => {
  test("adds a twelfth of the yearly property tax and insurance, and says so", () => {
    open("mortgage");
    type("Price", "400,000");
    type("Down payment", "80,000");
    type("Rate (percent a year)", "6.5");
    type("Years", "30");
    type("Property tax a year", "6,000");
    type("Insurance a year", "2,400");
    const house = { priceCents: 40_000_000, downPaymentCents: 8_000_000, annualRate: 0.065, years: 30, propertyTaxYearCents: 600_000, insuranceYearCents: 240_000 };
    const payment = loanMonthlyCents({ ...house, propertyTaxYearCents: 0, insuranceYearCents: 0 });
    expect(screen.getByTestId("loan-monthly").textContent).toBe(
      `Payment ${formatCents(payment)} + tax $500.00 + insurance $200.00 = ${formatCents(loanMonthlyCents(house))} a month`
    );
  });

  test("Use this hands back a mortgage with tax and insurance in the loan", () => {
    const onSave = vi.fn();
    open("mortgage", onSave);
    type("Price", "400000");
    type("Down payment", "80000");
    type("Rate (percent a year)", "6.5");
    type("Years", "30");
    type("Property tax a year", "6000");
    type("Insurance a year", "2400");
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      // The row stays open-ended -- the tax and insurance keep going after the loan is
      // paid off, even though the principal-and-interest part stops. A car
      // (above) carries no tax or insurance, so its row still ends at payoff.
      kind: "mortgage", label: "House", planningCategory: "Mortgage", fromPeriod: "2027-03", untilPeriod: null,
      loan: { priceCents: 40_000_000, downPaymentCents: 8_000_000, annualRate: 0.065, years: 30, propertyTaxYearCents: 600_000, insuranceYearCents: 240_000 },
    });
  });
});
