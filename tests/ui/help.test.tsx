// @vitest-environment jsdom
// tests/ui/help.test.tsx -- the three help surfaces: the "?" panel,
// the info point, and the Help section. Assertions read the expected words from
// src/help rather than hard-coding sentences: the prose gets edited, and an
// edit to wording must not fail a test. What is pinned is the WIRING -- the
// right article for the right screen, one definition shared by every surface.
import { afterEach, describe, expect, test, beforeEach } from "vitest";
import { NEEDED_OPEN_KEY } from "../../src/ui/what-if/LadderPanel";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

import HelpPanel from "../../src/ui/help/HelpPanel";
import HelpSection from "../../src/ui/help/HelpSection";
import InfoPoint from "../../src/ui/help/InfoPoint";
import { GETTING_STARTED_KEY, HELP_SCREENS, helpByKey } from "../../src/help";
import { GLOSSARY, findTerm } from "../../src/help/glossary";
import { rememberPotForHelp } from "../../src/help/household-words";
import { NAV } from "../../src/ui/shell/nav";

afterEach(cleanup);

describe("HelpPanel (the ? in the header)", () => {
  test("opens the article for the screen you are on, with a link into the Help section", async () => {
    const forecast = helpByKey("forecast")!;
    const { getByRole, findByText, getByText } = render(<HelpPanel sectionId="forecast" tabId={null} />);
    fireEvent.click(getByRole("button", { name: "Help for this screen" }));
    await findByText("Help: Forecast");
    expect(getByText(forecast.purpose)).toBeTruthy();
    expect(getByText("Open this in the Help section").getAttribute("href")).toBe("#/help/forecast");
  });

  test("a tab gets its own article, not its section's", async () => {
    const charts = helpByKey("budget.charts")!;
    const table = helpByKey("budget.month")!;
    expect(charts.purpose).not.toBe(table.purpose);
    const { getByRole, findByText, queryByText } = render(<HelpPanel sectionId="budget" tabId="charts" />);
    fireEvent.click(getByRole("button", { name: "Help for this screen" }));
    await findByText(charts.purpose);
    expect(queryByText(table.purpose)).toBeNull();
  });

  test("it stays open and follows you: moving to another screen swaps the article in place", async () => {
    const forecast = helpByKey("forecast")!;
    const bills = helpByKey("recurring.charges")!;
    const { getByRole, findByText, queryByText, rerender } = render(<HelpPanel sectionId="forecast" tabId={null} />);
    fireEvent.click(getByRole("button", { name: "Help for this screen" }));
    await findByText(forecast.purpose);
    rerender(<HelpPanel sectionId="recurring" tabId="charges" />);
    await findByText(bills.purpose);
    expect(queryByText(forecast.purpose)).toBeNull();
    // Pressing Help again closes it.
    fireEvent.click(getByRole("button", { name: "Help for this screen" }));
    await waitFor(() => expect(queryByText(bills.purpose)).toBeNull());
  });

  test("a full article shows its numbers with how each is worked out", async () => {
    const dash = helpByKey("dashboard")!;
    const { getByRole, findByText, getAllByText } = render(<HelpPanel sectionId="dashboard" tabId={null} />);
    fireEvent.click(getByRole("button", { name: "Help for this screen" }));
    await findByText("The numbers on this screen");
    expect(getAllByText("How it is worked out:").length).toBe(dash.numbers!.length);
    await findByText(dash.numbers![0].how);
  });
});

describe("InfoPoint (the i beside a number)", () => {
  test("shows the glossary's own definition, so a term cannot mean two things", async () => {
    const drawable = findTerm("drawable")!;
    const { getByRole, findByText } = render(<InfoPoint termId="drawable" />);
    fireEvent.click(getByRole("button", { name: `About ${drawable.term}` }));
    await findByText(drawable.definition);
  });

  test("an unknown term renders nothing rather than a dead icon", () => {
    const { container } = render(<InfoPoint termId="no-such-term" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("HelpSection (the manual in the sidebar)", () => {
  test("Help is in the navigation, and lists one article per screen plus getting started and the glossary", () => {
    expect(NAV.some((i) => i.id === "help")).toBe(true);
    const { getByRole } = render(<HelpSection selectedKey={null} />);
    const links = within(getByRole("navigation", { name: "Help articles" })).getAllByRole("link");
    // 19 screens, plus getting started and the glossary.
    // Settings: Merchants is a 20th screen, and Reports: Merchant a page under Reports.
    // Budget: Year is a 21st screen.
    // Accounts' two tabs became one page, so 20 screens.
    // C6: Settings: Appearance makes 21.
    // A6: Settings: Household makes 22, and Budget: Yearly costs 23, which moved to Recurring: Yearly bills (Recurring now has two tabs, so still 24).
    expect(links.length).toBe(24 + 1 + 2);
    expect(links.map((l) => l.textContent)).toEqual(expect.arrayContaining(["Settings: Merchants", "Reports: Merchant"]));
    expect(links.map((l) => l.textContent)).toContain("What if");
    expect(links.map((l) => l.textContent)).toContain("Forecast");
    expect(links.map((l) => l.textContent).join("|")).not.toMatch(/Acquisition|Long-term|Wealth|Runway/);
    expect(links[0].textContent).toBe("Getting started");
    expect(links.map((l) => l.textContent)).toContain("Budget: Charts");
    expect(links.map((l) => l.textContent)).toEqual(
      expect.arrayContaining(["Accounts", "Settings: Accounts", "Settings: Guide", "Settings: About"])
    );
    expect(links.map((l) => l.textContent).join("|")).not.toMatch(/Accounts: Balances|Accounts: Net worth/);
  });

  test("old help bookmarks to the moved articles open them", () => {
    const a = render(<HelpSection selectedKey="budget.yearly" />);
    expect(a.getByRole("heading", { level: 2, name: "Recurring: Yearly bills" })).toBeTruthy();
    a.unmount();
    expect(render(<HelpSection selectedKey="recurring" />).getByRole("heading", { level: 2, name: "Recurring: Charges" })).toBeTruthy();
  });

  test("the second route segment picks the article and marks it current", () => {
    const charts = helpByKey("budget.charts")!;
    const { getByRole, getByText } = render(<HelpSection selectedKey="budget.charts" />);
    expect(getByRole("heading", { level: 2, name: charts.title })).toBeTruthy();
    expect(getByText(charts.purpose)).toBeTruthy();
    expect(getByRole("link", { name: "Budget: Charts" }).getAttribute("aria-current")).toBe("page");
    expect(getByRole("link", { name: "Forecast" }).getAttribute("aria-current")).toBeNull();
  });

  test("no key, or a stale one, opens on getting started rather than a blank page", () => {
    const start = helpByKey(GETTING_STARTED_KEY)!;
    for (const key of [null, "a-screen-that-was-removed"]) {
      const { getByText, unmount } = render(<HelpSection selectedKey={key} />);
      expect(getByText(start.purpose)).toBeTruthy();
      unmount();
    }
  });

  test("the glossary lists every term once, alphabetically", () => {
    // With a charity pot on, its terms are listed too.
    rememberPotForHelp({ on: true, name: "Giving" });
    const { getByRole } = render(<HelpSection selectedKey="glossary" />);
    rememberPotForHelp(null);
    const shown = Array.from(getByRole("region", { name: "Glossary" }).querySelectorAll("dt")).map((d) => d.textContent);
    expect(shown.length).toBe(GLOSSARY.length);
    expect(shown).toEqual([...shown].sort((a, b) => (a ?? "").localeCompare(b ?? "")));
  });

  test("every article renders without throwing", () => {
    for (const s of HELP_SCREENS) {
      const { getByText, unmount } = render(<HelpSection selectedKey={s.key} />);
      expect(getByText(s.purpose)).toBeTruthy();
      unmount();
    }
  });
});

// --- where the info points are wired ---------------------------------------------
// Kept to the handful of labels that are not self-explanatory. Each one must
// resolve to a real glossary term, or InfoPoint renders nothing and the button
// below would be missing.
import EquationBar from "../../src/ui/shell/EquationBar";
import type { MastheadSummary } from "../../src/ui/lib/instrument";
import DashboardSection from "../../src/ui/DashboardSection";
import LadderPanel from "../../src/ui/what-if/LadderPanel";
import { whatIfLadder } from "../../src/domain/what-if";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import type { InstrumentReading } from "../../src/ui/lib/instrument";
import type { HeadState } from "../../src/ui/lib/useMastheadSummary";

// These tests read the two break-even statements, which sit in
// "Salary you would need", collapsed at first: open it before each test.
beforeEach(() => window.localStorage.setItem(NEEDED_OPEN_KEY, "true"));

const READING = { drawableCents: 7500000, burnCents: 700000, runwayMonths: 11.6, crossPeriod: "2027-08", series: [] } as unknown as InstrumentReading;

describe("info points on the screens", () => {
  const infoNames = (root: HTMLElement) =>
    Array.from(root.querySelectorAll("button[aria-label^='About ']")).map((b) => b.getAttribute("aria-label"));

  test("the top bar explains into the bank, and What-if when one is on (equation)", () => {
    const EQ = {
      month: { kind: "month", month: "2027-01", day: 13, daysInMonth: 31, noSalaryMonth: null, bankCents: 900000, maaserCents: 90000, budgetCents: 560000, leftOverCents: 250000, spentSoFarCents: 0, spentAgainstCents: 550000, bigMonths: [] },
      year: null,
      paySteps: { monthly: null, yearly: null, estimated: { monthly: false, yearly: false } },
    } as NonNullable<MastheadSummary["equation"]>;
    const { container, rerender } = render(<EquationBar equation={EQ} />);
    expect(infoNames(container)).toEqual(["About Into the bank"]);
    rerender(<EquationBar equation={EQ} scenarioLabel="Goal from Oct 2026" />);
    expect(infoNames(container)).toContain("About What-if");
    // "What is What-if?" read badly; every info button now reads "About {term}".
    expect(container.querySelectorAll("button[aria-label^='What is ']")).toHaveLength(0);
  });

  test("the Dashboard tiles explain Drawable, the monthly budget, Held back, trailing spending and Fixed cost", () => {
    const summary = {
      reading: { ...READING, series: [{ period: "2026-09", cents: 7500000 }, { period: "2026-10", cents: 6800000 }] },
      baselineSeries: null, scenarioLabel: null, heldBackCents: 1800000, recurringCents: 600000, variableCents: 130000,
      accountCount: 20, uncategorizedCount: 0, ruleCount: 400, lastSyncedAt: "2026-09-02T14:07:00-04:00",
      trailingCents: 640000, lastSeedAt: "2026-09-02T14:07:00-04:00", reseedDue: false,
    } as unknown as HeadState;
    const { container } = render(<DashboardSection summary={summary} planId="p1" onChanged={() => {}} />);
    // The Dashboard tile and the top bar both say Monthly budget: one number, one name, one meaning.
    expect(infoNames(container)).toEqual(
      expect.arrayContaining(["About Drawable", "About Monthly budget", "About Held back", "About Average spent, last 12 months", "About Fixed cost"])
    );
  });

  // the What if ladder replaced the Scenarios readouts.
  test("the What if ladder explains the price month and its two totals", () => {
    const w = { scenarioId: "w", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };
    const ladder = whatIfLadder(w, [{ planId: "p", planningCategory: "Rent", period: null, amountCents: 210_000 }], [], "2026-10", DEFAULT_SALARY_ASSUMPTIONS);
    rememberPotForHelp({ on: true, name: "Giving" });
    const { container } = render(<LadderPanel ladder={ladder} goals={[]} picks={[]} busy={false} onToggleGoal={() => {}} onMoveGoal={() => {}} />);
    rememberPotForHelp(null);
    // each total is an income statement. Since the salary follow-ups
    // The giving line, Take-home (after the pot) and the "in all" line (the top
    // bar's Take-home needed) each carry their own definition; Take-home pay is retired.
    expect(infoNames(container)).toEqual([
      // The term is now Usual month (the ladder prices a usual month).
      "About Usual month",
      "About Salary to live", "About Giving", "About Take-home", "About Take-home needed",
      "About Salary to live and hit goals", "About Giving", "About Take-home", "About Take-home needed",
    ]);
  });
});
