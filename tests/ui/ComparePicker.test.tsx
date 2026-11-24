// @vitest-environment jsdom
// tests/ui/ComparePicker.test.tsx
//
// What the period is compared with. Reports only.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ComparePicker from "../../src/ui/shell/ComparePicker";
import { configurePeriodStore, getCompare, pickPeriod, syncPeriodFromHash } from "../../src/ui/lib/period-store";
import { resolvePeriod } from "../../src/domain/period";

const AS_OF = "2026-09-20";

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "#/reports";
  configurePeriodStore({ asOf: () => AS_OF });
  syncPeriodFromHash();
});
afterEach(cleanup);

describe("ComparePicker", () => {
  test("a comparison can be selected by keyboard and Escape returns to the trigger", async () => {
    const user = userEvent.setup();
    render(<ComparePicker />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId("compare-trigger"));
    await user.keyboard("{Enter}");
    const previous = await screen.findByRole("button", { name: "Previous period" });
    for (let i = 0; i < 8 && document.activeElement !== previous; i++) await user.tab();
    expect(document.activeElement).toBe(previous);
    await user.keyboard(" ");
    expect(getCompare()).toBe("previous");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("compare-trigger")));
    await user.keyboard("{Enter}");
    await screen.findByRole("button", { name: "Previous period" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Previous period" })).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId("compare-trigger"));
  });

  test("says what the period is compared with, in words", () => {
    render(<ComparePicker />);
    const trigger = screen.getByTestId("compare-trigger");
    expect(trigger.textContent).toContain("No comparison");
    expect(trigger.getAttribute("aria-label")).toBe("Compare to: No comparison");
  });

  test("lists the comparisons, marks the current one, and picking one applies it", async () => {
    const user = userEvent.setup();
    render(<ComparePicker />);
    await user.click(screen.getByTestId("compare-trigger"));
    for (const name of ["No comparison", "Previous period", "Same period last year", "3-month average", "12-month average"]) {
      expect(await screen.findByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "No comparison" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Same period last year" }));
    expect(getCompare()).toBe("last-year");
    expect(window.location.hash).toBe("#/reports?period=last-12&compare=last-year");
    await waitFor(() => expect(screen.getByTestId("compare-trigger").textContent).toContain("Same period last year"));
  });

  test("says what each choice means for the period in view, including the same-days rule", async () => {
    const user = userEvent.setup();
    pickPeriod(resolvePeriod("this-month", AS_OF));
    render(<ComparePicker />);
    await user.click(screen.getByTestId("compare-trigger"));
    expect((await screen.findByTestId("compare-hint-previous")).textContent).toBe("Aug 1 to Aug 20, 2026");
    expect(screen.getByTestId("compare-hint-last-year").textContent).toBe("Sep 1 to Sep 20, 2025");
    expect(screen.getByTestId("compare-hint-avg-12").textContent).toBe("the average of the same days in the 12 months before");
  });

  test("with all time there is nothing to compare with: the choices are off and it says why", async () => {
    const user = userEvent.setup();
    pickPeriod(resolvePeriod("all", AS_OF));
    render(<ComparePicker />);
    await user.click(screen.getByTestId("compare-trigger"));
    expect((await screen.findByRole("button", { name: "Previous period" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "No comparison" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("compare-unavailable").textContent).toBe("All time has nothing before it. Choose a period with a start and an end to compare.");
  });
});
