// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetMonth from "../../src/ui/budget/BudgetMonth";
import { makeBudgetLayer, PLAN } from "./budget-fixtures";
import type { Plan } from "../../src/domain/plan-types";
import type { Db } from "../../src/ui/lib/db";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = RO;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => cleanup());

const PLAN_2027: Plan = { id: "plan-2027", name: "2027", startDate: "2027-01-01", endDate: "2027-12-31", createdAt: "" };
const suggestions = [{ planningCategory: "Groceries", amountCents: 50000, basis: { kind: "average" as const, months: 12, emptyMonths: 0 } }];

test("no Start 2027 budget in November", async () => {
  const { layer } = makeBudgetLayer();
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today="2026-11-30" />);
  await screen.findByRole("table", { name: "Budget for November 2026" });
  expect(screen.queryByRole("button", { name: "Start 2027 budget" })).toBeNull();
});

test("from December 1: Start 2027 budget previews from December's amounts and creates the plan only on its button", async () => {
  const user = userEvent.setup();
  const { layer } = makeBudgetLayer();
  layer.getSetup = vi.fn(async () => ({ suggestions }));
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today="2026-12-01" />);
  await screen.findByRole("table", { name: "Budget for December 2026" });
  await user.click(screen.getByRole("button", { name: "Start 2027 budget" }));
  const page = await screen.findByRole("region", { name: "Start 2027 budget" });
  expect(within(page).getByText(/Now is each line's amount in December 2026/)).toBeTruthy();
  await within(page).findByRole("checkbox", { name: "Groceries" });
  await user.click(within(page).getByRole("button", { name: "Cancel" }));
  expect(layer.startNextYear).not.toHaveBeenCalled();
  await user.click(await screen.findByRole("button", { name: "Start 2027 budget" }));
  const again = await screen.findByRole("region", { name: "Start 2027 budget" });
  await within(again).findByRole("checkbox", { name: "Groceries" });
  await user.click(within(again).getByRole("button", { name: "Start 2027 budget" }));
  expect(layer.startNextYear).toHaveBeenCalledWith(expect.anything(), PLAN.id, expect.arrayContaining([{ line: "Groceries", amountCents: 50000, source: "suggested" }]));
});

test("in January 2027 the month screen opens on 2027's budget and steps back into 2026's", async () => {
  const user = userEvent.setup();
  const { layer } = makeBudgetLayer();
  layer.listPlans = async () => [PLAN, PLAN_2027];
  const getLines = vi.fn(async (_db: Db, planId: string) => [
    { planId, planningCategory: "Groceries", period: null, amountCents: planId === "plan-2027" ? 52000 : 45000, source: "suggested" as const },
  ]);
  layer.getBudgetLines = getLines;
  render(<BudgetMonth planId="plan-2027" dataLayer={layer} today="2027-01-10" />);
  await screen.findByRole("table", { name: "Budget for January 2027" });
  expect(getLines).toHaveBeenLastCalledWith(expect.anything(), "plan-2027");
  await user.click(screen.getByRole("button", { name: /previous month/i }));
  await screen.findByRole("table", { name: "Budget for December 2026" });
  expect(getLines).toHaveBeenLastCalledWith(expect.anything(), "plan-2026");
});

test("after Start 2027 budget the button goes away (the plans are read again)", async () => {
  const user = userEvent.setup();
  const { layer } = makeBudgetLayer();
  let plans: Plan[] = [PLAN];
  layer.listPlans = async () => plans;
  layer.getSetup = vi.fn(async () => ({ suggestions }));
  layer.startNextYear = vi.fn(async () => {
    plans = [PLAN, PLAN_2027];
    return { plan: PLAN_2027 };
  });
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today="2026-12-01" />);
  await screen.findByRole("table", { name: "Budget for December 2026" });
  await user.click(screen.getByRole("button", { name: "Start 2027 budget" }));
  const page = await screen.findByRole("region", { name: "Start 2027 budget" });
  await within(page).findByRole("checkbox", { name: "Groceries" });
  await user.click(within(page).getByRole("button", { name: "Start 2027 budget" }));
  await screen.findByRole("table", { name: "Budget for December 2026" });
  expect(screen.queryByRole("button", { name: "Start 2027 budget" })).toBeNull();
});

// An income budget set by hand carries into next year too;
// Set up budget lists spending lines only, so these ride along at their December amount.
test("Start 2027 budget carries a hand-set income budget", async () => {
  const user = userEvent.setup();
  const { layer, state } = makeBudgetLayer();
  state.lines.push({ planId: PLAN.id, planningCategory: "Business Income", period: null, amountCents: 30000, source: "you" });
  layer.getSetup = vi.fn(async () => ({ suggestions }));
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today="2026-12-01" />);
  await screen.findByRole("table", { name: "Budget for December 2026" });
  await user.click(screen.getByRole("button", { name: "Start 2027 budget" }));
  const page = await screen.findByRole("region", { name: "Start 2027 budget" });
  await within(page).findByRole("checkbox", { name: "Groceries" });
  await user.click(within(page).getByRole("button", { name: "Start 2027 budget" }));
  expect(layer.startNextYear).toHaveBeenCalledWith(expect.anything(), PLAN.id, expect.arrayContaining([{ line: "Business Income", amountCents: 30000, source: "you" }]));
});

test("in January 2027 with only the 2026 budget, Start 2027 budget is offered and Set up budget is not", async () => {
  const { layer } = makeBudgetLayer();
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today="2027-01-05" />);
  await screen.findByRole("table", { name: "Budget for January 2027" });
  expect(screen.getByRole("button", { name: "Start 2027 budget" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Set up budget" })).toBeNull();
});

test("stepping back from January 2027 into December 2026 hides Set up budget", async () => {
  const user = userEvent.setup();
  const { layer } = makeBudgetLayer();
  layer.listPlans = async () => [PLAN, PLAN_2027];
  render(<BudgetMonth planId="plan-2027" dataLayer={layer} today="2027-01-10" />);
  await screen.findByRole("table", { name: "Budget for January 2027" });
  expect(screen.getByRole("button", { name: "Set up budget" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /previous month/i }));
  await screen.findByRole("table", { name: "Budget for December 2026" });
  expect(screen.queryByRole("button", { name: "Set up budget" })).toBeNull();
});

// An income budget set "from a month on" with no every-month row still carries.
test("Start 2027 budget carries an income budget set from a month on", async () => {
  const user = userEvent.setup();
  const { layer } = makeBudgetLayer({ changes: [{ id: 4, planId: PLAN.id, planningCategory: "Business Income", fromMonth: "2026-10", amountCents: 30000, reason: "changed", goalId: null, createdAt: "" }] });
  layer.getSetup = vi.fn(async () => ({ suggestions }));
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today="2026-12-01" />);
  await screen.findByRole("table", { name: "Budget for December 2026" });
  await user.click(screen.getByRole("button", { name: "Start 2027 budget" }));
  const page = await screen.findByRole("region", { name: "Start 2027 budget" });
  await within(page).findByRole("checkbox", { name: "Groceries" });
  await user.click(within(page).getByRole("button", { name: "Start 2027 budget" }));
  expect(layer.startNextYear).toHaveBeenCalledWith(expect.anything(), PLAN.id, expect.arrayContaining([{ line: "Business Income", amountCents: 30000, source: "you" }]));
});

// Start next year's totals preview exactly what it saves (goals do not carry).
test("Start 2027 budget's Monthly budget preview matches the lines it saves", async () => {
  const user = userEvent.setup();
  const goal = { id: 8, planId: PLAN.id, planningCategory: "Groceries", fromMonth: "2026-03", amountCents: 20000, reason: "goal" as const, goalId: "g1", createdAt: "" };
  const { layer } = makeBudgetLayer({ changes: [goal] });
  layer.getSetup = vi.fn(async () => ({ suggestions }));
  render(<BudgetMonth planId={PLAN.id} dataLayer={layer} today="2026-12-01" />);
  await screen.findByRole("table", { name: "Budget for December 2026" });
  await user.click(screen.getByRole("button", { name: "Start 2027 budget" }));
  const page = await screen.findByRole("region", { name: "Start 2027 budget" });
  await within(page).findByRole("checkbox", { name: "Groceries" });
  const after = within(page).getByTestId("setup-monthly").textContent ?? "";
  await user.click(within(page).getByRole("button", { name: "Start 2027 budget" }));
  const saved = (layer.startNextYear as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][2] as { line: string; amountCents: number }[];
  const total = saved.filter((l) => l.line !== "Business Income").reduce((s, l) => s + l.amountCents, 0);
  expect(after.split(" to ")[1]).toBe(`$${(total / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
});
