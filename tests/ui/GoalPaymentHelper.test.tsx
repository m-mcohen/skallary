// @vitest-environment jsdom
// tests/ui/GoalPaymentHelper.test.tsx -- "Work out the payment".
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GoalPaymentHelper from "../../src/ui/goals/GoalPaymentHelper";

afterEach(cleanup);

const rates = { thirtyYear: { ratePct: 7.03, weekOf: "2026-09-24" }, fifteenYear: { ratePct: 6.42, weekOf: "2026-09-24" } };
const getRates = async () => rates;

describe("GoalPaymentHelper", () => {
  test("the rate starts at Freddie Mac's 30-year average, labeled, and can be changed", async () => {
    const user = userEvent.setup();
    render(<GoalPaymentHelper targetCents={23_400_000} getRates={getRates} onUse={() => {}} />);
    expect(await screen.findByDisplayValue("7.03")).toBeTruthy();
    expect(screen.getByText("Freddie Mac weekly average, week of Sep 24, 2026: 7.03%")).toBeTruthy();
    await user.clear(screen.getByLabelText("Rate (%)"));
    await user.type(screen.getByLabelText("Rate (%)"), "6.5");
    expect((screen.getByLabelText("Rate (%)") as HTMLInputElement).value).toBe("6.5");
  });

  test("15 years switches to the 15-year average", async () => {
    const user = userEvent.setup();
    render(<GoalPaymentHelper targetCents={0} getRates={getRates} onUse={() => {}} />);
    await screen.findByDisplayValue("7.03");
    await user.clear(screen.getByLabelText("Years"));
    await user.type(screen.getByLabelText("Years"), "15");
    expect(await screen.findByDisplayValue("6.42")).toBeTruthy();
  });

  test("a term other than 30 or 15 years, or a rate you typed, is left alone", async () => {
    const user = userEvent.setup();
    render(<GoalPaymentHelper targetCents={0} getRates={getRates} onUse={() => {}} />);
    await screen.findByDisplayValue("7.03");
    await user.clear(screen.getByLabelText("Rate (%)"));
    await user.type(screen.getByLabelText("Rate (%)"), "5.9");
    await user.clear(screen.getByLabelText("Years"));
    await user.type(screen.getByLabelText("Years"), "15");
    expect((screen.getByLabelText("Rate (%)") as HTMLInputElement).value).toBe("5.9");
  });

  // No rate to be had.
  test("no rate to be had: empty, says so, and still works when you type one", async () => {
    render(<GoalPaymentHelper targetCents={0} getRates={async () => null} onUse={() => {}} />);
    expect(await screen.findByText("Could not get today's rate; type one.")).toBeTruthy();
    expect((screen.getByLabelText("Rate (%)") as HTMLInputElement).value).toBe("");
  });

  test("down payment starts empty; the goal target is one click away", async () => {
    const user = userEvent.setup();
    render(<GoalPaymentHelper targetCents={23_400_000} getRates={getRates} onUse={() => {}} />);
    expect((screen.getByLabelText("Down payment") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/Goal target: \$234,000(?![.\d])/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use the goal target as the down payment" }));
    expect((screen.getByLabelText("Down payment") as HTMLInputElement).value).toBe("234000.00");
  });

  test("the total adds tax, insurance and HOA, and Use this hands it over", async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    render(<GoalPaymentHelper targetCents={0} getRates={getRates} onUse={onUse} />);
    await screen.findByDisplayValue("7.03");
    await user.type(screen.getByLabelText("Price"), "800000");
    await user.type(screen.getByLabelText("Down payment"), "160000");
    await user.clear(screen.getByLabelText("Rate (%)"));
    await user.type(screen.getByLabelText("Rate (%)"), "6.5");
    await user.type(screen.getByLabelText("Property tax a year"), "12000");
    await user.type(screen.getByLabelText("Insurance a year"), "4800");
    await user.type(screen.getByLabelText("HOA a month"), "200");
    // $640,000 at 6.5% for 30 years = $4,045.24; + $1,000 tax + $400 insurance + $200 HOA, shown in whole dollars.
    expect(screen.getByTestId("helper-total").textContent).toBe("Payment $4,045 + tax $1,000 + insurance $400 + HOA $200 = $5,645 a month");
    await user.click(screen.getByRole("button", { name: "Use this" }));
    expect(onUse).toHaveBeenCalledWith(564524);
  });

  test("until there is a price and a rate it says what it is waiting for", async () => {
    render(<GoalPaymentHelper targetCents={0} getRates={async () => null} onUse={() => {}} />);
    expect(await screen.findByText("Type the price and the rate to see the payment.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Use this" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
