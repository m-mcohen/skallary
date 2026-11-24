// @vitest-environment jsdom
// tests/ui/EquationBar.test.tsx
//
// The top bar as one statement: into the bank, less
// the pot's amount put away, less the budget, equals left over; Month / Year; spent so far under the budget;
// the pay steps behind "into the bank"; folded to the result on a phone. Made-up figures.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import EquationBar from "../../src/ui/shell/EquationBar";
import type { MastheadSummary } from "../../src/ui/lib/instrument";
import type { MonthEquation, YearEquation } from "../../src/domain/equation";

type Eq = NonNullable<MastheadSummary["equation"]>;

const MONTH: MonthEquation = {
  kind: "month", month: "2027-01", day: 13, daysInMonth: 31, noSalaryMonth: null,
  bankCents: 900000, maaserCents: 90000, budgetCents: 560000, leftOverCents: 250000,
  spentSoFarCents: 240000, spentAgainstCents: 550000, bigMonths: [],
};
const YEAR: YearEquation = {
  kind: "year", year: "2027", mixedNote: null, monthsWithoutPay: [],
  bankCents: 10800000, maaserCents: 1080000, budgetCents: 6900000, leftOverCents: 2820000,
  spentSoFarCents: 240000, spentAgainstCents: 6700000, bigMonths: [{ label: "Pesach groceries", cents: 65000 }, { label: "Chanukah groceries", cents: 65000 }],
};
const STEPS = [
  { id: "gross", label: "Gross pay", cents: 1200000, total: false },
  { id: "bank", label: "Into the bank", cents: 900000, total: true },
  { id: "maaser", label: "Charity, put away (a tenth)", cents: -90000, total: false },
  { id: "take-home", label: "Take-home", cents: 810000, total: true },
];
const EQ: Eq = { month: MONTH, year: YEAR, paySteps: { monthly: STEPS, yearly: STEPS.map((s) => ({ ...s, cents: s.cents * 12 })), estimated: { monthly: true, yearly: true } } };

const bar = () => screen.getByTestId("equation-bar");
const term = (id: string) => within(bar()).getByTestId(`eq-${id}`);

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
});
afterEach(cleanup);

describe("desktop", () => {
  test("four terms and the result, in order, labelled in plain words, adding up", () => {
    render(<EquationBar equation={EQ} />);
    expect(term("bank").textContent).toContain("$9,000.00");
    expect(term("bank").textContent).toContain("into the bank");
    expect(term("maaser").textContent).toContain("$900.00");
    expect(term("maaser").textContent).toContain("charity, put away");
    expect(term("budget").textContent).toContain("$5,600.00");
    expect(term("left").textContent).toContain("$2,500.00");
    expect(term("left").textContent).toContain("left over");
    expect(9000 - 900 - 5600).toBe(2500);
  });

  test("spent so far sits under the budget, with a bar measured against the budget without Charity", () => {
    render(<EquationBar equation={EQ} />);
    expect(term("budget").textContent).toContain("$2,400.00 spent so far");
    const p = within(term("budget")).getByRole("progressbar");
    expect(p.getAttribute("aria-valuenow")).toBe("240000");
    expect(p.getAttribute("aria-valuemax")).toBe("550000");
  });

  test("the progress bar's accessible values stay valid when over budget, and say so in words", () => {
    const over = { ...EQ, month: { ...MONTH, spentSoFarCents: 700000, spentAgainstCents: 550000 } };
    render(<EquationBar equation={over} />);
    const p = within(term("budget")).getByRole("progressbar");
    const now = Number(p.getAttribute("aria-valuenow"));
    const max = Number(p.getAttribute("aria-valuemax"));
    expect(now).toBeLessThanOrEqual(max);
    expect(max).toBe(700000);
    expect(p.getAttribute("aria-valuetext")).toBe("$7,000.00 spent of $5,500.00, over by $1,500.00");
    cleanup();
    render(<EquationBar equation={EQ} />);
    expect(within(term("budget")).getByRole("progressbar").getAttribute("aria-valuetext")).toBe("$2,400.00 spent of $5,500.00");
  });

  test("a big month is named in the budget term", () => {
    const dec = { ...EQ, month: { ...MONTH, month: "2026-12", bigMonths: [{ label: "Chanukah groceries", cents: 65000 }] } };
    render(<EquationBar equation={dec} />);
    expect(term("budget").textContent).toContain("budget, incl. Chanukah groceries +$650");
  });

  test("no salary for the month: says so with a link, dashes for the pot and left over, never $0.00", () => {
    const oct = { ...EQ, month: { ...MONTH, month: "2026-10", noSalaryMonth: "2026-10", bankCents: null, maaserCents: null, leftOverCents: null, budgetCents: 610000, spentSoFarCents: 700000, spentAgainstCents: 560000 } };
    render(<EquationBar equation={oct} />);
    expect(term("bank").textContent).toContain("No salary");
    expect(term("bank").textContent).toContain("add it in Settings, Salary");
    expect(within(term("bank")).getByRole("link", { name: "Settings, Salary" }).getAttribute("href")).toBe("#/settings/salary");
    expect(term("maaser").textContent).not.toContain("$0.00");
    expect(term("left").textContent).not.toContain("$0.00");
    expect(term("left").textContent).toContain("–");
    expect(term("budget").textContent).toContain("over by $1,400.00");
  });

  test("Month / Year switches every figure, and the choice is remembered", () => {
    render(<EquationBar equation={EQ} />);
    fireEvent.click(screen.getByRole("tab", { name: "Year" }));
    expect(term("bank").textContent).toContain("$108,000.00");
    expect(term("period").textContent).toContain("2027");
    expect(term("left").textContent).toContain("$28,200.00");
    expect(term("budget").textContent).toContain("incl. 2 big months +$1,300");
    expect(term("budget").textContent).toContain("$2,400.00 spent so far");
    expect(window.localStorage.getItem("equation-bar-view")).toBe("year");
  });

  test("a partly covered year carries its note", () => {
    render(<EquationBar equation={{ ...EQ, year: { ...YEAR, mixedNote: "Jan to Nov actual, Dec budget" } }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Year" }));
    expect(bar().textContent).toContain("Jan to Nov actual, Dec budget");
  });

  test("the info point on into the bank opens the pay steps", () => {
    render(<EquationBar equation={EQ} />);
    fireEvent.click(within(term("bank")).getByRole("button", { name: "About Into the bank" }));
    const steps = screen.getByTestId("pay-steps");
    expect(steps.textContent).toContain("Gross pay");
    expect(steps.textContent).toContain("$12,000.00");
    expect(steps.textContent).toContain("Take-home");
  });

  test("the estimates note shows only when the steps use estimated taxes", () => {
    const firmMonthly = { ...EQ, paySteps: { ...EQ.paySteps, estimated: { monthly: false, yearly: true } } };
    const { unmount } = render(<EquationBar equation={EQ} />);
    fireEvent.click(within(term("bank")).getByRole("button", { name: "About Into the bank" }));
    expect(screen.getByTestId("pay-steps").textContent).toContain("Some lines are estimates");
    unmount();
    cleanup();
    render(<EquationBar equation={firmMonthly} />);
    fireEvent.click(within(term("bank")).getByRole("button", { name: "About Into the bank" }));
    expect(screen.getByTestId("pay-steps").textContent).not.toContain("Some lines are estimates");
    // The Year steps follow their own flag, both ways.
    cleanup();
    render(<EquationBar equation={{ ...EQ, paySteps: { ...EQ.paySteps, estimated: { monthly: true, yearly: false } } }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Year" }));
    fireEvent.click(within(term("bank")).getByRole("button", { name: "About Into the bank" }));
    expect(screen.getByTestId("pay-steps").textContent).not.toContain("Some lines are estimates");
    cleanup();
    render(<EquationBar equation={firmMonthly} />);
    fireEvent.click(screen.getByRole("tab", { name: "Year" }));
    fireEvent.click(within(term("bank")).getByRole("button", { name: "About Into the bank" }));
    expect(screen.getByTestId("pay-steps").textContent).toContain("Some lines are estimates");
  });

  // The period is named out loud and the figures need to be easy to tell apart, with no motion.
  test("the period is named out loud, and the switch says which one is on", () => {
    render(<EquationBar equation={EQ} />);
    expect(term("period").textContent).toContain("January 2027");
    expect(term("period").textContent).toContain("day 13 of 31");
    const tabs = within(bar()).getByRole("tablist", { name: "Month or year" });
    expect(within(tabs).getByRole("tab", { name: "Month" }).getAttribute("aria-selected")).toBe("true");
    expect(within(tabs).getByRole("tab", { name: "Year" }).getAttribute("aria-selected")).toBe("false");
    expect(within(tabs).getByTestId("eq-thumb")).toBeTruthy();
    fireEvent.click(within(tabs).getByRole("tab", { name: "Year" }));
    expect(within(tabs).getByRole("tab", { name: "Year" }).getAttribute("aria-selected")).toBe("true");
    expect(term("period").textContent).not.toContain("January");
  });

  test("switching period brings every figure in fresh, so the change is seen", () => {
    render(<EquationBar equation={EQ} />);
    const before = within(term("left")).getByTestId("eq-figure");
    expect(before.getAttribute("data-enter")).toBe("month");
    fireEvent.click(screen.getByRole("tab", { name: "Year" }));
    const after = within(term("left")).getByTestId("eq-figure");
    expect(after).not.toBe(before);
    expect(after.getAttribute("data-enter")).toBe("year");
    for (const id of ["bank", "maaser", "budget", "left"]) expect(within(term(id)).getByTestId("eq-figure").getAttribute("data-enter")).toBe("year");
  });

  // The layout must not move on a switch. Each cell also holds the other
  // period's term, invisible, so it is as wide as the wider of the two.
  test("each term holds the other period's figure invisibly, so a switch moves nothing", () => {
    render(<EquationBar equation={EQ} />);
    const ghosts = bar().querySelectorAll("[data-ghost]");
    expect(ghosts.length).toBe(5);
    for (const g of ghosts) {
      expect(g.getAttribute("aria-hidden")).toBe("true");
      expect(g.className).toContain("invisible");
      expect(g.querySelector("[data-testid]")).toBeNull();
    }
    expect(term("left").parentElement!.parentElement!.textContent).toContain("$28,200.00");
    expect(screen.getAllByTestId("eq-left")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "Year" }));
    expect(term("left").parentElement!.parentElement!.textContent).toContain("$2,500.00");
  });

  // The bar can be folded.
  test("it folds to one line on request, keeping the switch and what is left over", () => {
    const onCollapsedChange = vi.fn();
    const { rerender } = render(<EquationBar equation={EQ} onCollapsedChange={onCollapsedChange} />);
    const hide = screen.getByRole("button", { name: "Hide the equation" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(hide);
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    rerender(<EquationBar equation={EQ} collapsed onCollapsedChange={onCollapsedChange} />);
    expect(screen.queryByTestId("eq-bank")).toBeNull();
    expect(term("left").textContent).toContain("$2,500.00");
    expect(term("left").textContent).toContain("left over, January 2027");
    fireEvent.click(screen.getByRole("tab", { name: "Year" }));
    expect(term("left").textContent).toContain("left over, 2027");
    const show = screen.getByRole("button", { name: "Show the equation" });
    expect(show.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(show);
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });

  // The right-hand note once wrapped into a sliver and was cut off. A year with a month
  // missing its salary says so under "into the bank", where it belongs, and the right-hand notes never wrap.
  test("a year month with no salary is named under into the bank, and the right-hand notes never wrap", () => {
    render(<EquationBar equation={{ ...EQ, year: { ...YEAR, monthsWithoutPay: ["2027-03"] } }} scenarioLabel="New job" />);
    fireEvent.click(screen.getByRole("tab", { name: "Year" }));
    expect(term("bank").textContent).toContain("into the bank, no salary in March");
    const notes = within(bar()).getByTestId("eq-notes");
    expect(notes.textContent).not.toContain("No salary");
    expect(notes.className).toContain("whitespace-nowrap");
    expect(notes.className).toContain("shrink-0");
  });

  // The tabs control a real panel; a folded bar keeps its height before the figures land;
  // the figures scroll inside themselves so the fold button never leaves the screen.
  test("the Month and Year tabs control the figures as their panel", () => {
    render(<EquationBar equation={EQ} />);
    const panel = within(bar()).getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: "Month" }).id);
    expect(within(panel).getByTestId("eq-left")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Year" }));
    expect(within(bar()).getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: "Year" }).id);
  });

  test("a folded bar keeps the folded height while loading, unreachable or unreadable", () => {
    for (const props of [{}, { unavailable: true }, { unreadable: true }]) {
      render(<EquationBar equation={null} collapsed {...props} />);
      expect(bar().className).toMatch(/\b(min-)?h-12\b/);
      cleanup();
    }
    render(<EquationBar equation={null} />);
    expect(bar().className).toMatch(/\bh-16\b/);
  });

  test("the figures scroll inside themselves, open or folded, so the fold button stays put", () => {
    const { rerender } = render(<EquationBar equation={EQ} scenarioLabel="A very long what-if name" />);
    expect(screen.getByTestId("eq-main").className).toContain("overflow-x-auto");
    expect(bar().className).not.toContain("overflow-x-auto");
    rerender(<EquationBar equation={EQ} collapsed scenarioLabel="A very long what-if name" />);
    expect(screen.getByTestId("eq-main").className).toContain("overflow-x-auto");
    expect(screen.getByTestId("eq-main").contains(screen.getByRole("button", { name: "Show the equation" }))).toBe(false);
  });

  test("the old figures are gone from the top", () => {
    render(<EquationBar equation={EQ} />);
    expect(bar().textContent).not.toMatch(/Drawable|Salary needed|Take-home needed/);
  });

  test("a what-if on is named", () => {
    render(<EquationBar equation={EQ} scenarioLabel="New job + 401(k)" />);
    expect(bar().textContent).toContain("What-if on: New job + 401(k)");
  });

  test("a failed read says so in one plain line: no skeleton, no zero, no dash", () => {
    render(<EquationBar equation={null} unreadable />);
    expect(bar().textContent).toBe("Couldn't read your transactions, so the figures across the top are missing. Reload, or press Sync.");
    expect(screen.queryByTestId("equation-loading")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$0\.00|–/);
    cleanup();
    // A statement that did read wins over the flag. The shell's own sync check reads the same transactions,
    // so it says "unavailable" too when they fail; the flag is only set when the server answered the other
    // reads, so the line wins over the quiet strip. With no flag, an unreachable server keeps the strip.
    render(<EquationBar equation={EQ} unreadable />);
    expect(bar().textContent).toContain("into the bank");
    cleanup();
    render(<EquationBar equation={null} unreadable unavailable />);
    expect(bar().textContent).toContain("Couldn't read your transactions");
    cleanup();
    render(<EquationBar equation={null} unavailable />);
    expect(bar().textContent).toBe("");
  });

  test("loading shows a skeleton and no zero; unreachable shows an empty strip", () => {
    const { unmount } = render(<EquationBar equation={null} />);
    expect(screen.getByTestId("equation-loading")).toBeTruthy();
    expect(document.body.textContent).not.toContain("$0.00");
    unmount();
    render(<EquationBar equation={null} unavailable />);
    expect(screen.queryByTestId("equation-loading")).toBeNull();
  });
});

describe("phone", () => {
  beforeEach(() => Object.defineProperty(window, "innerWidth", { configurable: true, value: 393 }));

  test("folded: only the result, the bar and spent so far; a tap opens the statement, remembered", () => {
    render(<EquationBar equation={EQ} />);
    const fold = screen.getByRole("button", { name: /left over, January 2027/ });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(fold.textContent).toContain("$2,500.00");
    expect(fold.textContent).toContain("left over, January 2027");
    expect(bar().textContent).toContain("Spent so far $2,400.00 of $5,500.00");
    expect(screen.queryByTestId("eq-maaser")).toBeNull();
    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(term("maaser").textContent).toContain("$900.00");
    expect(window.localStorage.getItem("equation-bar-open")).toBe("true");
  });
  test("folded, the switch is still there, outside the fold button", () => {
    render(<EquationBar equation={EQ} />);
    const fold = screen.getByRole("button", { name: /left over, January 2027/ });
    const year = screen.getByRole("tab", { name: "Year" });
    expect(fold.contains(year)).toBe(false);
    fireEvent.click(year);
    expect(screen.getByRole("button", { name: /left over, 2027/ }).textContent).toContain("$28,200.00");
    expect(fold.getAttribute("aria-expanded")).toBe("false");
  });
});
