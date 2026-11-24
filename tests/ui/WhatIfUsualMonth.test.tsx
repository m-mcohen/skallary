// @vitest-environment jsdom
// tests/ui/WhatIfUsualMonth.test.tsx
//
// The What if screen prices a usual
// month. Change a cost's "Today" amount is the line's every-month amount, not next
// month's one-month amount, and the ladder says it prices a usual month.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import WhatIfSection, { type WhatIfDataLayer } from "../../src/ui/what-if/WhatIfSection";
import type { Scenario } from "../../src/domain/scenario";
import type { WhatIf } from "../../src/domain/what-if";
import type { BudgetLine } from "../../src/domain/plan-types";
import type { Db } from "../../src/ui/lib/db";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import { addMonths } from "../../src/domain/scenario";
import { localDateIso } from "../../src/domain/period";

afterEach(cleanup);

const nextMonth = addMonths(localDateIso().slice(0, 7), 1);
// Rent is $2,500.00 every month and $3,000.00 next month only.
const LINES: BudgetLine[] = [
  { planId: "p1", planningCategory: "Rent", period: null, amountCents: 250_000 },
  { planId: "p1", planningCategory: "Charity", period: null, amountCents: 50_000 },
  { planId: "p1", planningCategory: "Rent", period: nextMonth, amountCents: 300_000 },
];
const row: Scenario = { id: "w1", planId: "p1", name: "Offer A", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" };
const offer: WhatIf = { scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };

const layer: WhatIfDataLayer = {
  loadDb: async () => ({}) as Db,
  listScenarios: async () => [row],
  listWhatIfs: async () => [offer],
  saveWhatIf: vi.fn(async () => {}),
  createWhatIf: vi.fn(async () => offer),
  upsertScenario: vi.fn(async () => {}),
  deleteScenario: vi.fn(async () => {}),
  getBudgetLines: async () => LINES,
  getSalarySettings: async () => DEFAULT_SALARY_ASSUMPTIONS,
  listGoals: async () => [],
  getAccounts: async () => [],
  getAccountBalances: async () => [],
  listGoalAccountLinks: async () => [],
  getTransactions: async () => [],
  listWishlistItems: async () => [],
};

test("Change a cost shows the line's every-month amount, not next month's one-month amount", async () => {
  render(<WhatIfSection planId="p1" dataLayer={layer} />);
  fireEvent.click(await screen.findByRole("button", { name: "Change a cost" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Budget line"), { target: { value: "Rent" } });
  expect(within(dialog).getByTestId("line-today").textContent).toBe("Today $2,500.00 a month");
});

test("the ladder says it prices a usual month", async () => {
  render(<WhatIfSection planId="p1" dataLayer={layer} />);
  expect((await screen.findByTestId("price-month")).textContent).toBe("Priced for a usual month: each budget line's every-month amount, with every row that is switched on.");
});
