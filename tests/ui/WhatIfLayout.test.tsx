// @vitest-environment jsdom
// tests/ui/WhatIfLayout.test.tsx
// The What if screen's reading order the ladder, with Your income,
// on the left and the what-if's list on the right; on a phone they stack ladder first.
// Income while this is on folds open and shut, open at first, remembered on this computer.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WhatIfSection, { type WhatIfDataLayer } from "../../src/ui/what-if/WhatIfSection";
import { INCOME_OPEN_KEY } from "../../src/ui/what-if/IncomeCard";
import type { Scenario } from "../../src/domain/scenario";
import type { WhatIf } from "../../src/domain/what-if";
import type { BudgetLine } from "../../src/domain/plan-types";
import type { Db } from "../../src/ui/lib/db";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const line = (planningCategory: string, amountCents: number): BudgetLine => ({ planId: "p1", planningCategory, period: null, amountCents });
const LINES = [line("Rent", 250_000), line("Groceries", 90_000), line("Charity", 50_000)];
const scenario: Scenario = { id: "w1", planId: "p1", name: "Offer A", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" };
const whatIf: WhatIf = { scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };

function layer(): WhatIfDataLayer {
  return {
    loadDb: async () => ({}) as Db,
    listScenarios: async () => [scenario],
    listWhatIfs: async () => [whatIf],
    saveWhatIf: vi.fn(async () => {}),
    createWhatIf: vi.fn(async () => whatIf),
    upsertScenario: vi.fn(async () => {}),
    deleteScenario: vi.fn(async () => {}),
    getBudgetLines: async () => LINES,
    getSalarySettings: async () => ({ ...DEFAULT_SALARY_ASSUMPTIONS, currentSalary: { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "2026-11" } }),
    listGoals: async () => [],
    getAccounts: async () => [],
    getAccountBalances: async () => [],
    listGoalAccountLinks: async () => [],
    getTransactions: async () => [],
    listWishlistItems: async () => [],
  };
}

const renderScreen = () => render(<WhatIfSection planId="p1" dataLayer={layer()} onChanged={vi.fn()} />);

describe("the What if screen's reading order", () => {
  test("the ladder comes before the list, so it sits on the left and first on a phone", async () => {
    renderScreen();
    const ladder = await screen.findByTestId("ladder-panel");
    const list = screen.getByText("What this what-if includes").closest("[data-slot='card']")!;
    expect(ladder.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ladder.parentElement).toBe(list.parentElement);
    expect(ladder.parentElement!.className).toContain("lg:grid-cols-2");
  });
});

describe("Income while this is on", () => {
  test("is open at first, folds shut to one line naming the salary, and is remembered", async () => {
    const { unmount } = renderScreen();
    const toggle = await screen.findByRole("button", { name: "Income while this is on" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("radio", { name: "Current salary" })).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("radio", { name: "Current salary" })).toBeNull();
    expect(screen.getByTestId("income-shut-summary").textContent).toMatch(/Current salary\. Settings, Salary: \$120,000 a year/);
    expect(window.localStorage.getItem(INCOME_OPEN_KEY)).toBe("false");
    unmount();
    renderScreen();
    expect((await screen.findByRole("button", { name: "Income while this is on" })).getAttribute("aria-expanded")).toBe("false");
  });
});
