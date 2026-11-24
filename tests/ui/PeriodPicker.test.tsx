// @vitest-environment jsdom
// tests/ui/PeriodPicker.test.tsx
//
// The top-bar control for the period the history screens share.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PeriodPicker from "../../src/ui/shell/PeriodPicker";
import { configurePeriodStore, getPeriod, syncPeriodFromHash } from "../../src/ui/lib/period-store";
import { customPeriod, resolvePeriod } from "../../src/domain/period";

const AS_OF = "2026-09-20";

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "#/reports";
  configurePeriodStore({ asOf: () => AS_OF });
  syncPeriodFromHash();
});
afterEach(cleanup);

describe("PeriodPicker", () => {
  test("a preset can be selected by keyboard and Escape returns to the trigger", async () => {
    const user = userEvent.setup();
    render(<PeriodPicker />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId("period-trigger"));
    await user.keyboard("{Enter}");
    const lastMonth = await screen.findByRole("button", { name: "Last month" });
    for (let i = 0; i < 12 && document.activeElement !== lastMonth; i++) await user.tab();
    expect(document.activeElement).toBe(lastMonth);
    await user.keyboard(" ");
    expect(getPeriod()).toEqual({ preset: "last-month", from: "2026-08-01", to: "2026-08-31" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("period-trigger")));
    await user.keyboard("{Enter}");
    await screen.findByRole("button", { name: "Last month" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Last month" })).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId("period-trigger"));
  });

  test("the button names the period in words, for the eye and for a screen reader", () => {
    render(<PeriodPicker />);
    const trigger = screen.getByTestId("period-trigger");
    expect(trigger.textContent).toContain("Last 12 months");
    expect(trigger.getAttribute("aria-label")).toBe("Period: Last 12 months");
  });

  test("lists every preset, marks the current one, and picking one applies it everywhere", async () => {
    const user = userEvent.setup();
    render(<PeriodPicker />);
    await user.click(screen.getByTestId("period-trigger"));

    const names = ["This month", "Last month", "This quarter", "Last 3 months", "Last 12 months", "Year to date", "Last year", "All time"];
    for (const name of names) expect(await screen.findByRole("button", { name })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Last 12 months" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Year to date" }).getAttribute("aria-pressed")).toBe("false");

    await user.click(screen.getByRole("button", { name: "Year to date" }));
    expect(getPeriod()).toEqual(resolvePeriod("ytd", AS_OF));
    expect(window.location.hash).toBe("#/reports?period=ytd");
    await waitFor(() => expect(screen.getByTestId("period-trigger").textContent).toContain("Year to date"));
  });

  test("a custom range needs two real dates before Apply works, then applies them", async () => {
    const user = userEvent.setup();
    render(<PeriodPicker />);
    await user.click(screen.getByTestId("period-trigger"));

    const apply = await screen.findByRole("button", { name: "Apply" });
    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    // The boxes start on the period in view, so a small adjustment is a small edit.
    expect((from as HTMLInputElement).value).toBe("2025-10-01");
    expect((to as HTMLInputElement).value).toBe("2026-09-20");

    fireEvent.change(to, { target: { value: "" } });
    expect((apply as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(from, { target: { value: "2026-03-05" } });
    fireEvent.change(to, { target: { value: "2026-02-10" } }); // typed backwards
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    await user.click(apply);

    expect(getPeriod()).toEqual(customPeriod("2026-02-10", "2026-03-05"));
    await waitFor(() => expect(screen.getByTestId("period-trigger").textContent).toContain("Feb 10 to Mar 5, 2026"));
  });

  test("follows a period that arrives by the link, such as a click-through ledger", async () => {
    render(<PeriodPicker />);
    window.location.hash = "#/transactions?ledger=1&label=Groceries&from=2026-08-01&to=2026-08-31&counted=1&back=%23%2Freports";
    syncPeriodFromHash();
    await waitFor(() => expect(screen.getByTestId("period-trigger").textContent).toContain("Aug 1 to Aug 31, 2026"));
  });
});
