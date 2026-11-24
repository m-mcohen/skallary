// @vitest-environment jsdom
// tests/ui/WhatIfOneTime.test.tsx
//
// The What if list gains "One-time cost": a label, an
// amount and the month it is paid. It joins the list switched on, says its month,
// switches and moves like any row, and the ladder says it never counts there.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import WhatIfSection, { type WhatIfDataLayer } from "../../src/ui/what-if/WhatIfSection";
import type { Scenario } from "../../src/domain/scenario";
import type { WhatIf } from "../../src/domain/what-if";
import type { BudgetLine } from "../../src/domain/plan-types";
import type { Db } from "../../src/ui/lib/db";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import { describeRow } from "../../src/ui/what-if/ChangeRow";

afterEach(cleanup);

const LINES: BudgetLine[] = [
  { planId: "p1", planningCategory: "Rent", period: null, amountCents: 250_000 },
  { planId: "p1", planningCategory: "Charity", period: null, amountCents: 50_000 },
];
const scenario: Scenario = { id: "w1", planId: "p1", name: "Big year", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" };

function fakeLayer(w: WhatIf) {
  let saved = w;
  const layer: WhatIfDataLayer = {
    loadDb: async () => ({}) as Db,
    listScenarios: async () => [scenario],
    listWhatIfs: async () => [saved],
    saveWhatIf: vi.fn(async (_db: Db, next: WhatIf) => {
      saved = structuredClone(next);
    }),
    createWhatIf: vi.fn(),
    upsertScenario: vi.fn(),
    deleteScenario: vi.fn(),
    getBudgetLines: async () => LINES,
    getSalarySettings: async () => DEFAULT_SALARY_ASSUMPTIONS,
    listGoals: async () => [],
    getAccounts: async () => [],
    getAccountBalances: async () => [],
    listGoalAccountLinks: async () => [],
    getTransactions: async () => [],
  };
  return layer;
}
const lastSaved = (layer: WhatIfDataLayer) => {
  const calls = (layer.saveWhatIf as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][1] as WhatIf;
};

describe("adding a one-time cost", () => {
  test("a label, an amount and a month; it joins the bottom of the list, switched on, saying its month", async () => {
    const layer = fakeLayer({ scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] });
    render(<WhatIfSection planId="p1" dataLayer={layer} />);
    fireEvent.click(await screen.findByRole("button", { name: "One-time cost" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Budget line")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Name of the cost"), { target: { value: "Renovation" } });
    fireEvent.change(within(dialog).getByLabelText("Amount, paid once"), { target: { value: "15,000" } });
    fireEvent.change(within(dialog).getByLabelText("Month it is paid"), { target: { value: "2027-03" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add cost" }));
    await waitFor(() => expect(layer.saveWhatIf).toHaveBeenCalled());
    const w = lastSaved(layer);
    expect(w.changes).toEqual([
      expect.objectContaining({ kind: "one-time", label: "Renovation", amountCents: 1_500_000, fromPeriod: "2027-03", untilPeriod: "2027-03", loan: null }),
    ]);
    expect(w.rows).toEqual([{ kind: "change", refId: w.changes[0].id, position: 1, on: true }]);
    const listed = await screen.findByText("Renovation");
    expect(listed.closest("li")!.textContent).toMatch(/\$15,000\.00 once, in Mar 2027/);
  });

  test("a month is required, in plain words", async () => {
    const layer = fakeLayer({ scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] });
    render(<WhatIfSection planId="p1" dataLayer={layer} />);
    fireEvent.click(await screen.findByRole("button", { name: "One-time cost" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name of the cost"), { target: { value: "Renovation" } });
    fireEvent.change(within(dialog).getByLabelText("Amount, paid once"), { target: { value: "15,000" } });
    fireEvent.change(within(dialog).getByLabelText("Month it is paid"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add cost" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Pick the month it is paid.");
    expect(layer.saveWhatIf).not.toHaveBeenCalled();
  });
});

describe("on the list", () => {
  const w: WhatIf = {
    scenarioId: "w1",
    salaryGrossAnnualCents: null,
    salaryFromPeriod: null,
    changes: [
      { id: "car", position: 1, kind: "add", label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2026-11", untilPeriod: null, loan: null },
      { id: "reno", position: 2, kind: "one-time", label: "Renovation", planningCategory: "One-time cost", amountCents: 1_500_000, fromPeriod: "2027-03", untilPeriod: "2027-03", loan: null },
    ],
    rows: [
      { kind: "change", refId: "car", position: 1, on: true },
      { kind: "change", refId: "reno", position: 2, on: true },
    ],
  };

  test("switched and moved like any row", async () => {
    const layer = fakeLayer(w);
    render(<WhatIfSection planId="p1" dataLayer={layer} />);
    fireEvent.click(await screen.findByRole("switch", { name: "Include Renovation" }));
    await waitFor(() => expect(lastSaved(layer).rows.find((r) => r.refId === "reno")!.on).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Move Renovation up" }));
    await waitFor(() => expect(lastSaved(layer).rows.map((r) => r.refId)).toEqual(["reno", "car"]));
  });

  test("the ladder leaves it out and says why", async () => {
    render(<WhatIfSection planId="p1" dataLayer={fakeLayer(w)} />);
    const ladder = await screen.findByTestId("ladder-panel");
    expect(within(ladder).queryByText(/Renovation/)).toBeNull();
    expect(ladder.textContent).toMatch(/One-time costs and down payments are paid once and never count here/);
  });

  test("its row reads its amount and month", () => {
    expect(describeRow({ kind: "change", refId: "reno", position: 1, on: true, label: "Renovation", monthlyCents: 1_500_000, change: w.changes[1] })).toBe("$15,000.00 once, in Mar 2027");
  });
});
