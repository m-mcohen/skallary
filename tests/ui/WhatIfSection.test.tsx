// @vitest-environment jsdom
// tests/ui/WhatIfSection.test.tsx
// The What if screen. Pick, name, income, and an
// ordered list of changes. Every finished edit saves the whole what-if at once,
// and nothing on this screen switches the app's what-if.
import { afterEach, describe, expect, test, vi, beforeEach } from "vitest";
import { NEEDED_OPEN_KEY } from "../../src/ui/what-if/LadderPanel";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import WhatIfSection, { type WhatIfDataLayer } from "../../src/ui/what-if/WhatIfSection";
import type { Scenario } from "../../src/domain/scenario";
import type { WhatIf } from "../../src/domain/what-if";
import type { BudgetLine } from "../../src/domain/plan-types";
import type { Db } from "../../src/ui/lib/db";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { whatIfLadder } from "../../src/domain/what-if";
import { addMonths } from "../../src/domain/scenario";
import { localDateIso } from "../../src/domain/period";
import { formatWholeDollars } from "../../src/domain/money";
import { cashForecast } from "../../src/domain/cash-forecast";
import { computeRunway } from "../../src/domain/runway";
import type { Goal } from "../../src/domain/plan-types";

// These tests read the two break-even statements, which sit in
// "Salary you would need", collapsed at first: open it before each test.
beforeEach(() => window.localStorage.setItem(NEEDED_OPEN_KEY, "true"));

const goal = (id: string, name: string): Goal =>
  ({ id, name, type: "savings", targetAmountCents: 1_000_000, targetDate: "2028-01-01", plannedMonthlyCents: 10_000, archivedAt: null }) as unknown as Goal;

afterEach(cleanup);

const line = (planningCategory: string, amountCents: number): BudgetLine => ({ planId: "p1", planningCategory, period: null, amountCents });
const LINES = [line("Rent", 250_000), line("Groceries", 90_000), line("Charity", 50_000), line("Restaurants & Bars", 20_000)];
const row = (id: string, name: string): Scenario => ({ id, planId: "p1", name, isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" });

/** An in-memory store behind the data layer, so each test reads back what the screen wrote. */
function fakeLayer(start: { rows?: Scenario[]; whatIfs?: WhatIf[] } = {}) {
  const rows = new Map((start.rows ?? []).map((r) => [r.id, r]));
  const ifs = new Map((start.whatIfs ?? []).map((w) => [w.scenarioId, w]));
  const layer: WhatIfDataLayer = {
    loadDb: async () => ({}) as Db,
    listScenarios: async () => [...rows.values()],
    listWhatIfs: async () => [...ifs.values()],
    saveWhatIf: vi.fn(async (_db: Db, w: WhatIf) => {
      ifs.set(w.scenarioId, structuredClone(w));
    }),
    createWhatIf: vi.fn(async (_db: Db, planId: string, id: string, name: string) => {
      const s: Scenario = { id, planId, name, isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" };
      const w: WhatIf = { scenarioId: id, salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };
      rows.set(id, s);
      ifs.set(id, w);
      return w;
    }),
    upsertScenario: vi.fn(async (_db: Db, s: Scenario) => {
      rows.set(s.id, s);
    }),
    deleteScenario: vi.fn(async (_db: Db, id: string) => {
      rows.delete(id);
      ifs.delete(id);
    }),
    getBudgetLines: async () => LINES,
    getSalarySettings: async () => DEFAULT_SALARY_ASSUMPTIONS,
    listGoals: async () => [],
    getAccounts: async () => [],
    getAccountBalances: async () => [],
    listGoalAccountLinks: async () => [],
    getTransactions: async () => [],
    listWishlistItems: async () => [],
  };
  return { layer, rows, ifs };
}

const offerRow = row("w1", "Offer A $120k base");
const offer: WhatIf = { scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };
const withChanges: WhatIf = {
  ...offer,
  changes: [
    { id: "c1", position: 1, kind: "add", label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2027-03", untilPeriod: null, loan: null },
    { id: "c2", position: 2, kind: "cut", label: "Uber Eats", planningCategory: "Restaurants & Bars", amountCents: 10_000, fromPeriod: "2026-10", untilPeriod: null, loan: null },
  ],
};

const renderScreen = (layer: WhatIfDataLayer, onChanged = vi.fn()) =>
  render(<WhatIfSection planId="p1" dataLayer={layer} onChanged={onChanged} />);

const renderScreenWithBoth = (layer: WhatIfDataLayer, onChanged: ReturnType<typeof vi.fn>, onWhatIfSaved: ReturnType<typeof vi.fn>) =>
  render(<WhatIfSection planId="p1" dataLayer={layer} onChanged={onChanged} onWhatIfSaved={onWhatIfSaved} />);

const lastSaved = (layer: WhatIfDataLayer) => {
  const calls = (layer.saveWhatIf as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][1] as WhatIf;
};

describe("What if: picking and naming", () => {
  test("with none saved, it offers to start one", async () => {
    renderScreen(fakeLayer().layer);
    expect(await screen.findByText("No what-ifs yet. Start one.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New what-if" })).toBeTruthy();
  });

  // The card's figure is the budget before the what-if, and
  // carried the same name as the top bar's figure after it, which read as the same number.
  test("the Changes card names its figure the budget before these changes", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    renderScreen(layer);
    expect(await screen.findByText(/Budget before these changes/)).toBeTruthy();
    // The ladder's income statements carry their own "Monthly budget, charity aside" line;
    // the list card does not call its figure Monthly budget.
    const ladder = await screen.findByTestId("ladder-panel");
    expect(screen.queryAllByText(/^Monthly budget/).filter((el) => !ladder.contains(el))).toEqual([]);
  });

  test("opens on the first what-if, and lists only what-ifs (not older scenarios)", async () => {
    const { layer } = fakeLayer({ rows: [row("old", "Offer A $130k (counter)"), offerRow], whatIfs: [offer] });
    renderScreen(layer);
    const picker = (await screen.findByLabelText("What-if")) as HTMLSelectElement;
    await waitFor(() => expect(picker.value).toBe("w1"));
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Offer A $120k base"]);
  });

  test("New asks for a name, creates the what-if, selects it, and tells the app", async () => {
    const onChanged = vi.fn();
    const { layer, rows, ifs } = fakeLayer();
    renderScreen(layer, onChanged);
    fireEvent.click(await screen.findByRole("button", { name: "New what-if" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Offer A $120k" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect((screen.getByLabelText("What-if") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Offer A $120k"));
    const created = [...rows.values()][0];
    expect(created).toMatchObject({ name: "Offer A $120k", income: { kind: "plan" }, expenseDeltas: [], isDefault: false });
    expect(ifs.get(created.id)).toMatchObject({ salaryGrossAnnualCents: null, changes: [], rows: [] });
    expect(onChanged).toHaveBeenCalled();
    // One request, not the old upsertScenario + saveWhatIf pair.
    expect(layer.createWhatIf).toHaveBeenCalledWith(expect.anything(), "p1", expect.any(String), "Offer A $120k");
    expect(layer.upsertScenario).not.toHaveBeenCalled();
    expect(layer.saveWhatIf).not.toHaveBeenCalled();
  });

  // With the old two-request flow, a failure on the
  // second request left an orphaned scenario row behind; with one request,
  // a failure leaves nothing at all.
  test("a failed create leaves nothing behind", async () => {
    const { layer, rows, ifs } = fakeLayer();
    layer.createWhatIf = vi.fn(async () => {
      throw new Error("Could not create (500).");
    });
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "New what-if" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Offer A $120k" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Could not create (500).")).toBeTruthy();
    expect(rows.size).toBe(0);
    expect(ifs.size).toBe(0);
  });

  test("a blank name is refused", async () => {
    const { layer } = fakeLayer();
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "New what-if" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create" }));
    expect(await screen.findByText("Give the what-if a name.")).toBeTruthy();
    expect(layer.upsertScenario).not.toHaveBeenCalled();
  });

  test("Rename changes the name", async () => {
    const { layer, rows } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const box = (await screen.findByLabelText("Name")) as HTMLInputElement;
    expect(box.value).toBe("Offer A $120k base");
    fireEvent.change(box, { target: { value: "Offer A $120k" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(rows.get("w1")!.name).toBe("Offer A $120k"));
  });

  test("Delete asks first, and only the confirmation deletes", async () => {
    const onChanged = vi.fn();
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    renderScreen(layer, onChanged);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete Offer A $120k base? This cannot be undone.")).toBeTruthy();
    expect(layer.deleteScenario).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete what-if" }));
    await waitFor(() => expect(layer.deleteScenario).toHaveBeenCalledWith(expect.anything(), "w1"));
    expect(await screen.findByText("No what-ifs yet. Start one.")).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  test("the screen has no way to switch the app's what-if: editing never switches the app", () => {
    // tsc does not check tests, so this reads the source: no picker callback, no setter, no default.
    for (const file of ["WhatIfSection.tsx", "ChangeForm.tsx", "ChangeRow.tsx"]) {
      const src = readFileSync(join(__dirname, "../../src/ui/what-if", file), "utf8");
      expect(src).not.toMatch(/onPickScenario|setScenarioId|setDefaultScenario|isDefault: true/);
    }
  });
});

describe("the two refresh callbacks", () => {
  test("an edit to income, changes or goal picks calls the lighter onWhatIfSaved, not onChanged", async () => {
    const onChanged = vi.fn();
    const onWhatIfSaved = vi.fn();
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [withChanges] });
    renderScreenWithBoth(layer, onChanged, onWhatIfSaved);
    fireEvent.click(await screen.findByRole("button", { name: "Move Uber Eats up" }));
    await waitFor(() => expect(onWhatIfSaved).toHaveBeenCalled());
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("naming, creating or deleting a what-if still calls the full onChanged, not the lighter one", async () => {
    const onChanged = vi.fn();
    const onWhatIfSaved = vi.fn();
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    renderScreenWithBoth(layer, onChanged, onWhatIfSaved);
    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Offer A $120k" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onWhatIfSaved).not.toHaveBeenCalled();
  });
});

describe("What if: income", () => {
  // With no salary of its own a what-if keeps the current
  // salary from Settings, Salary, so the first choice says so instead of None.
  test("a salary typed with a comma or a dollar sign saves as that many dollars, from its month", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    renderScreen(layer);
    fireEvent.click(await screen.findByLabelText("A different salary"));
    fireEvent.change(screen.getByLabelText("Yearly base salary"), { target: { value: "$120,000" } });
    fireEvent.change(screen.getByLabelText("Salary starts"), { target: { value: "2026-11" } });
    fireEvent.click(screen.getByRole("button", { name: "Save income" }));
    await waitFor(() => expect(lastSaved(layer)).toMatchObject({ salaryGrossAnnualCents: 12_000_000, salaryFromPeriod: "2026-11" }));
  });

  test("a salary with no start month of its own saves with an open month: it starts with the current salary", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    renderScreen(layer);
    fireEvent.click(await screen.findByLabelText("A different salary"));
    fireEvent.change(screen.getByLabelText("Yearly base salary"), { target: { value: "120000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save income" }));
    await waitFor(() => expect(lastSaved(layer)).toMatchObject({ salaryGrossAnnualCents: 12_000_000, salaryFromPeriod: null }));
  });

  test("Current salary clears the what-if's own salary", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [{ ...offer, salaryGrossAnnualCents: 12_000_000, salaryFromPeriod: "2026-11" }] });
    renderScreen(layer);
    expect(((await screen.findByLabelText("Yearly base salary")) as HTMLInputElement).value).toBe("120,000");
    fireEvent.click(screen.getByLabelText("Current salary"));
    await waitFor(() => expect(lastSaved(layer)).toMatchObject({ salaryGrossAnnualCents: null, salaryFromPeriod: null }));
  });

  // A refused save used to move the radio right away, leaving the
  // screen showing no salary while the server still had one.
  test("choosing Current salary when that save fails leaves the radio on A different salary, with the salary still there", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [{ ...offer, salaryGrossAnnualCents: 12_000_000, salaryFromPeriod: "2026-11" }] });
    layer.saveWhatIf = vi.fn(async () => {
      throw new Error("The app could not be reached.");
    });
    renderScreen(layer);
    expect(((await screen.findByLabelText("Yearly base salary")) as HTMLInputElement).value).toBe("120,000");
    fireEvent.click(screen.getByLabelText("Current salary"));
    expect(await screen.findByText("Not saved: The app could not be reached.")).toBeTruthy();
    expect((screen.getByLabelText("A different salary") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Current salary") as HTMLInputElement).checked).toBe(false);
    expect(((screen.getByLabelText("Yearly base salary")) as HTMLInputElement).value).toBe("120,000");
  });

  test("an additional salary of its own: a W-2 salary from a month, or None", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    renderScreen(layer);
    const pick = (await screen.findByLabelText("Additional salary while this is on")) as HTMLSelectElement;
    expect(pick.value).toBe("same");
    fireEvent.change(pick, { target: { value: "w2" } });
    fireEvent.change(screen.getByLabelText("Additional yearly salary"), { target: { value: "50,000" } });
    fireEvent.change(screen.getByLabelText("Additional salary starts"), { target: { value: "2027-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save income" }));
    await waitFor(() => expect(lastSaved(layer).additionalSalary).toEqual({ kind: "w2", grossAnnualCents: 5_000_000, fromPeriod: "2027-01" }));
    fireEvent.change(screen.getByLabelText("Additional salary while this is on"), { target: { value: "none" } });
    fireEvent.click(screen.getByRole("button", { name: "Save income" }));
    await waitFor(() => expect(lastSaved(layer).additionalSalary).toBe("none"));
  });
});

describe("What if: changes", () => {
  // The Wish List is one-time items and never reaches a projection.
  test("the runway line never reads the Wish List", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    const listWishlistItems = vi.fn(async () => []);
    (layer as unknown as Record<string, unknown>).listWishlistItems = listWishlistItems;
    renderScreen(layer);
    await screen.findByTestId("whatif-runway");
    expect(listWishlistItems).not.toHaveBeenCalled();
  });

  // The list says no months (costs carry no start month).
  test("the list shows each change in list order, with its amount", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [withChanges] });
    renderScreen(layer);
    const items = await screen.findAllByTestId("list-row");
    expect(items.map((i) => i.getAttribute("data-ref-id"))).toEqual(["c1", "c2"]);
    expect(items[0].textContent).toMatch(/New car/);
    expect(items[0].textContent).toMatch(/\$700\.00 a month/);
    expect(items[0].textContent).not.toMatch(/Mar 2027/);
    expect(items[1].textContent).toMatch(/Cut Restaurants & Bars to \$100\.00 a month/);
  });

  test("Add a cost: a name, a line, an amount a month; it saves in order", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [withChanges] });
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "Add a cost" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name of the change"), { target: { value: "Gym" } });
    fireEvent.change(within(dialog).getByLabelText("Budget line"), { target: { value: "Gym" } });
    fireEvent.change(within(dialog).getByLabelText("Amount a month"), { target: { value: "50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add change" }));
    await waitFor(() => expect(lastSaved(layer).changes.map((c) => c.label)).toEqual(["New car", "Uber Eats", "Gym"]));
    expect(lastSaved(layer).changes[2]).toMatchObject({ kind: "add", planningCategory: "Gym", amountCents: 5_000, untilPeriod: null, position: 3, loan: null });
  });

  test("Change a cost shows the line's amount today beside the new amount", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "Change a cost" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Budget line"), { target: { value: "Rent" } });
    expect(within(dialog).getByTestId("line-today").textContent).toBe("Today $2,500.00 a month");
    fireEvent.change(within(dialog).getByLabelText("New amount a month"), { target: { value: "3,000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add change" }));
    await waitFor(() => expect(lastSaved(layer).changes[0]).toMatchObject({ kind: "change", label: "Rent", planningCategory: "Rent", amountCents: 300_000 }));
  });

  test("Cut a cost only offers budget lines, and a blank amount means cut to zero", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "Cut a cost" }));
    const dialog = await screen.findByRole("dialog");
    const lineBox = within(dialog).getByLabelText("Budget line") as HTMLSelectElement;
    expect([...lineBox.options].map((o) => o.value)).toEqual(["", "Charity", "Groceries", "Rent", "Restaurants & Bars"]);
    fireEvent.change(lineBox, { target: { value: "Groceries" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add change" }));
    await waitFor(() => expect(lastSaved(layer).changes[0]).toMatchObject({ kind: "cut", planningCategory: "Groceries", amountCents: 0 }));
  });

  // The month fields are gone, and with them "The end month is before the start month."
  // A form problem still stops the save: a Cut above today's amount.
  test("a refused change is said in the dialog and nothing is saved", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "Cut a cost" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Budget line"), { target: { value: "Groceries" } });
    fireEvent.change(within(dialog).getByLabelText("New amount a month"), { target: { value: "2,000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add change" }));
    expect(await within(dialog).findByText("A cut has to be lower than today's amount. Use Change a cost to raise a line.")).toBeTruthy();
    expect(layer.saveWhatIf).not.toHaveBeenCalled();
  });

  test("up and down arrows reorder, and the order is saved as positions", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [withChanges] });
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "Move Uber Eats up" }));
    await waitFor(() => expect(lastSaved(layer).changes.map((c) => [c.id, c.position])).toEqual([["c2", 1], ["c1", 2]]));
    expect((screen.getByRole("button", { name: "Move Uber Eats up" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("Edit reopens a change with its values, and saving replaces it in place", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [withChanges] });
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "Edit New car" }));
    const dialog = await screen.findByRole("dialog");
    const amount = within(dialog).getByLabelText("Amount a month") as HTMLInputElement;
    expect(amount.value).toBe("700.00");
    fireEvent.change(amount, { target: { value: "650" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save change" }));
    await waitFor(() => expect(lastSaved(layer).changes.map((c) => [c.id, c.amountCents])).toEqual([["c1", 65_000], ["c2", 10_000]]));
  });

  test("Car opens the calculator, and its payment joins the list with the loan kept", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "Car" }));
    const dialog = await screen.findByRole("dialog");
    for (const [label, value] of [["Price", "35000"], ["Down payment", "5000"], ["Rate (percent a year)", "6.5"], ["Years", "5"]]) {
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this" }));
    await waitFor(() => expect(lastSaved(layer).changes[0]).toMatchObject({ kind: "car", label: "New car", planningCategory: "Car payment", loan: { downPaymentCents: 500_000, years: 5 } }));
    expect((await screen.findAllByTestId("list-row"))[0].textContent).toMatch(/Car payment of \$586\.9\d a month, on Car payment, plus \$5,000\.00 down, paid once/);
  });

  test("editing a car opens the calculator, not the plain form", async () => {
    const car = { id: "car", position: 1, kind: "car" as const, label: "New car", planningCategory: "Car payment", amountCents: 58_698, fromPeriod: "2027-03", untilPeriod: "2032-02",
      loan: { priceCents: 3_500_000, downPaymentCents: 500_000, annualRate: 0.065, years: 5 } };
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [{ ...offer, changes: [car] }] });
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "Edit New car" }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText("Price") as HTMLInputElement).value).toBe("35,000.00");
  });

  test("the ladder panel shows the figures whatIfLadder computes for this what-if", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [withChanges] });
    renderScreen(layer);
    const expected = whatIfLadder(withChanges, LINES, [], addMonths(localDateIso().slice(0, 7), 1), DEFAULT_SALARY_ASSUMPTIONS);
    expect((await screen.findByTestId("salary-to-live")).textContent).toBe(`${formatWholeDollars(expected.salaryToLiveCents)} a year`);
  });

  // A goal's saving is a row like any other, switched on and off in place.
  test("switching a goal's saving on and off saves its row; archived goals are not listed", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [{ ...offer, rows: [{ kind: "goal-saving", refId: "house", position: 1, on: true }] }] });
    layer.listGoals = async () => [goal("house", "House"), goal("car2", "Second vehicle"), { ...goal("old", "Old goal"), archivedAt: "2026-01-01" }];
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("switch", { name: "Include Saving for Second vehicle" }));
    await waitFor(() => expect(lastSaved(layer).rows).toEqual([
      { kind: "goal-saving", refId: "house", position: 1, on: true },
      { kind: "goal-saving", refId: "car2", position: 2, on: true },
    ]));
    expect(screen.queryByRole("switch", { name: "Include Saving for Old goal" })).toBeNull(); // archived goals are not offered
    fireEvent.click(await screen.findByRole("switch", { name: "Include Saving for House" }));
    await waitFor(() => expect(lastSaved(layer).rows).toEqual([
      { kind: "goal-saving", refId: "house", position: 1, on: false },
      { kind: "goal-saving", refId: "car2", position: 2, on: true },
    ]));
  });

  // The line is the Forecast screen's own figure under this what-if,
  // real income against its costs (cashForecast), not a no-income runway.
  test("the runway line is the Forecast screen's figure for this what-if", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [withChanges] });
    layer.getAccounts = async () => [{ id: "chk", name: "Checking", type: "depository", institution: "B", currency: "USD", isOwned: true, includeInSpend: true, owner: "me" } as never];
    layer.getAccountBalances = async () => [{ accountId: "chk", balanceCents: 2_000_000, asOf: "2026-09-01" }];
    renderScreen(layer);
    const r = computeRunway(2_000_000, cashForecast({ budgetLines: LINES, asOfDate: localDateIso(), assumptions: DEFAULT_SALARY_ASSUMPTIONS, whatIf: withChanges }));
    const text = (await screen.findByTestId("whatif-runway")).textContent ?? "";
    expect(text).toMatch(/^Runway with this what-if: /);
    expect(text).toContain(r.crossZeroPeriod === null ? "lasts past 24 months" : `${r.runwayMonths} months`);
  });

  // A refused save showed its reason behind the open dialog.
  test("a save refused while a dialog is open says why inside the dialog, and the button is off while saving", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    let reject: (e: Error) => void = () => {};
    layer.saveWhatIf = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "Add a cost" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name of the change"), { target: { value: "Gym" } });
    fireEvent.change(within(dialog).getByLabelText("Budget line"), { target: { value: "Gym" } });
    fireEvent.change(within(dialog).getByLabelText("Amount a month"), { target: { value: "50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add change" }));
    await waitFor(() => expect((within(dialog).getByRole("button", { name: "Add change" }) as HTMLButtonElement).disabled).toBe(true));
    reject(new Error("The app could not be reached."));
    expect(await within(dialog).findByText("Not saved: The app could not be reached.")).toBeTruthy();
  });

  test("an income line is refused in the form, before anything is sent", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "Add a cost" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name of the change"), { target: { value: "Bonus" } });
    fireEvent.change(within(dialog).getByLabelText("Budget line"), { target: { value: "Income" } });
    fireEvent.change(within(dialog).getByLabelText("Amount a month"), { target: { value: "50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add change" }));
    expect(await within(dialog).findByText("Income is not a cost. A what-if's salary goes in Income while this is on.")).toBeTruthy();
    expect(layer.saveWhatIf).not.toHaveBeenCalled();
  });

  test("removing a change asks first", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [withChanges] });
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "Remove New car" }));
    expect(await screen.findByText("Remove New car from this what-if?")).toBeTruthy();
    expect(layer.saveWhatIf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove change" }));
    await waitFor(() => expect(lastSaved(layer).changes.map((c) => [c.id, c.position])).toEqual([["c2", 1]]));
  });

  test("a save that fails shows the reason and keeps the list as it was saved", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [withChanges] });
    layer.saveWhatIf = vi.fn(async () => {
      throw new Error("The end month is before the start month.");
    });
    renderScreen(layer);
    fireEvent.click(await screen.findByRole("button", { name: "Move Uber Eats up" }));
    expect(await screen.findByText("Not saved: The end month is before the start month.")).toBeTruthy();
    expect(screen.getAllByTestId("list-row").map((i) => i.getAttribute("data-ref-id"))).toEqual(["c1", "c2"]);
  });
});

// Check a salary on the screen prices each step against
// the changes it accepted, so a refused step never makes a later one look cheaper.
describe("What if: Check a salary uses the what-if's own changes", () => {
  test("rent raised twice: the smaller raise is never covered by a salary that cannot pay it", async () => {
    const { checkSalary: check } = await import("../../src/domain/what-if");
    const twice: WhatIf = {
      ...offer,
      changes: [
        { id: "r1", position: 1, kind: "change", label: "Rent to $6,000", planningCategory: "Rent", amountCents: 600_000, fromPeriod: "2027-01", untilPeriod: null, loan: null },
        { id: "r2", position: 2, kind: "change", label: "Rent to $4,000", planningCategory: "Rent", amountCents: 400_000, fromPeriod: "2027-01", untilPeriod: null, loan: null },
      ],
    };
    const nextMonth = addMonths(localDateIso().slice(0, 7), 1);
    const ladder = whatIfLadder(twice, LINES, [], nextMonth, DEFAULT_SALARY_ASSUMPTIONS);
    const context = { whatIf: twice, baseLines: LINES };
    // The first salary where the old walk and the fixed walk disagree.
    let gross = 0;
    for (let g = 5_000_000; g <= 30_000_000; g += 100_000) {
      const oldWay = check(ladder, g, DEFAULT_SALARY_ASSUMPTIONS);
      const fixed = check(ladder, g, DEFAULT_SALARY_ASSUMPTIONS, context);
      if (JSON.stringify(oldWay.items) !== JSON.stringify(fixed.items)) {
        gross = g;
        break;
      }
    }
    expect(gross).toBeGreaterThan(0);
    const expected = check(ladder, gross, DEFAULT_SALARY_ASSUMPTIONS, context);
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [twice] });
    renderScreen(layer);
    const box = (await screen.findByLabelText("Salary to check")) as HTMLInputElement;
    fireEvent.change(box, { target: { value: String(gross / 100) } });
    await waitFor(() => expect(screen.getAllByTestId("check-item").map((i) => i.textContent)).toEqual(expected.items.map((i) => `${i.label}: ${i.covered ? "covered" : "not covered"}`)));
    expect(expected.items.find((i) => i.id === "r2")?.covered).toBe(false);
  });
});

// A ticked goal's planned
// ongoing cost is a rung inside Salary to live and shortens that what-if's runway.
describe("What if: a goal's ongoing cost", () => {
  const checking = { id: "a1", name: "Checking", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" } as never;
  const balance = { accountId: "a1", balanceCents: 5_000_000, asOf: "2026-09-30" } as never;
  const house = { ...goal("House", "House"), ongoingMonthlyCents: 500_000, ongoingStartedPeriod: null } as Goal;

  const runwayWith = async (picked: boolean) => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [{ ...offer, rows: picked ? [{ kind: "goal-cost", refId: "House", position: 1, on: true }] : [] }] });
    layer.listGoals = async () => [house];
    layer.getAccounts = async () => [checking];
    layer.getAccountBalances = async () => [balance];
    renderScreen(layer);
    const text = (await screen.findByTestId("whatif-runway")).textContent ?? "";
    // The steps sit behind a button under Salary to live's statement
    // (under its "in all" line).
    const show = screen.queryByRole("button", { name: /^Show the salary each step needs/ });
    if (show) fireEvent.click(show);
    const rung = document.querySelector('[data-rung-id="cost:House"]');
    const out = { months: Number(/(\d+) months?/.exec(text)?.[1] ?? Number.NaN), rung: rung?.textContent ?? null };
    cleanup();
    return out;
  };

  test("switched on, it is a rung above Salary to live, and the runway is shorter", async () => {
    const off = await runwayWith(false);
    const on = await runwayWith(true);
    expect(off.rung).toBeNull();
    expect(on.rung).toContain("House, ongoing cost");
    expect(Number.isFinite(off.months)).toBe(true);
    expect(on.months).toBeLessThan(off.months);
  });

  // Already in the budget, so never on the list;
  // it sits in a collapsed Completed goals section, with the reason in view.
  test("a goal whose cost has started is not on the list; it sits in Completed goals, collapsed", async () => {
    const started = { ...house, ongoingStartedPeriod: "2026-09", ongoingBudgetLine: "Mortgage" } as Goal;
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    layer.listGoals = async () => [started];
    renderScreen(layer);
    const toggle = await screen.findByRole("button", { name: /Completed goals/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Already in your budget")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /House/ })).toBeNull();
    expect(screen.queryByTestId("goal-started-House")).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByTestId("goal-started-House")).toBeTruthy();
  });

  test("with none started, there is no Completed goals section", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [offer] });
    layer.listGoals = async () => [house];
    renderScreen(layer);
    await screen.findAllByTestId("list-row");
    expect(screen.queryByRole("button", { name: /Completed goals/ })).toBeNull();
  });
});

// One list, in list
// order, every row switchable and saved per what-if; no start months; a verdict
// at the top when a salary applies.
describe("the one list", () => {
  const houseGoal = { ...goal("house", "House"), plannedMonthlyCents: 100_000, ongoingMonthlyCents: 500_000, ongoingStartedPeriod: null } as Goal;
  const tripGoal = { ...goal("trip", "Family trip"), plannedMonthlyCents: 40_000 } as Goal;
  const listed: WhatIf = {
    ...withChanges,
    rows: [
      { kind: "goal-saving", refId: "house", position: 1, on: true },
      { kind: "change", refId: "c1", position: 2, on: true },
      { kind: "change", refId: "c2", position: 3, on: false },
      { kind: "goal-cost", refId: "house", position: 4, on: false },
    ],
  };
  const open = (w: WhatIf, goals: Goal[] = [houseGoal, tripGoal]) => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [w] });
    layer.listGoals = async () => goals;
    renderScreen(layer);
    return layer;
  };
  const rowIds = async () => (await screen.findAllByTestId("list-row")).map((r) => `${r.getAttribute("data-row-kind")}:${r.getAttribute("data-ref-id")}`);
  const switchFor = (label: string) => screen.getByRole("switch", { name: `Include ${label}` });

  test("changes and goal rows sit in one list, in list order, each with its own switch; a new goal arrives off", async () => {
    open(listed);
    expect(await rowIds()).toEqual(["goal-saving:house", "change:c1", "change:c2", "goal-cost:house", "goal-saving:trip"]);
    expect(switchFor("Saving for House").getAttribute("aria-checked")).toBe("true");
    expect(switchFor("New car").getAttribute("aria-checked")).toBe("true");
    expect(switchFor("Uber Eats").getAttribute("aria-checked")).toBe("false");
    expect(switchFor("House, ongoing cost").getAttribute("aria-checked")).toBe("false");
    expect(switchFor("Saving for Family trip").getAttribute("aria-checked")).toBe("false"); // never stored: off
  });

  // The old tick boxes were 13 px; each switch sits in a 24 px target.
  test("each switch sits in a target at least 24 px square", async () => {
    open(listed);
    await rowIds();
    for (const sw of screen.getAllByRole("switch")) {
      expect(sw.parentElement!.className).toMatch(/min-h-6/);
      expect(sw.parentElement!.className).toMatch(/min-w-6/);
    }
  });

  test("a fully saved goal's row says so", async () => {
    open(listed, [houseGoal, { ...tripGoal, completedAt: "2026-09-30T00:00:00Z" } as Goal]);
    await rowIds();
    expect(screen.getAllByTestId("list-row").find((r) => r.getAttribute("data-ref-id") === "trip")!.textContent).toMatch(/Fully saved, nothing more needed/);
  });

  test("a goal saving row says what it saves a month and where the amount comes from", async () => {
    open(listed);
    const rows = await screen.findAllByTestId("list-row");
    expect(rows[0].textContent).toMatch(/\$1,000\.00 a month/);
    expect(rows[0].textContent).toMatch(/your planned amount/);
  });

  test("switching a row off saves it off, and the ladder drops it at once", async () => {
    const layer = open(listed);
    const before = (await screen.findByTestId("salary-to-live")).textContent;
    fireEvent.click(switchFor("New car"));
    await waitFor(() => expect(lastSaved(layer).rows.find((r) => r.refId === "c1")).toMatchObject({ kind: "change", on: false }));
    await waitFor(() => expect(screen.getByTestId("salary-to-live").textContent).not.toBe(before));
    expect(document.querySelector('[data-rung-id="c1"]')).toBeNull();
  });

  test("switching a new goal on saves its row on, in place", async () => {
    const layer = open(listed);
    await rowIds();
    fireEvent.click(switchFor("Saving for Family trip"));
    await waitFor(() => expect(lastSaved(layer).rows.map((r) => [r.kind, r.refId, r.position, r.on])).toEqual([
      ["goal-saving", "house", 1, true],
      ["change", "c1", 2, true],
      ["change", "c2", 3, false],
      ["goal-cost", "house", 4, false],
      ["goal-saving", "trip", 5, true],
    ]));
  });

  test("the arrows move any row, a goal row past a change", async () => {
    const layer = open(listed);
    await rowIds();
    fireEvent.click(screen.getByRole("button", { name: "Move Saving for House down" }));
    await waitFor(() => expect(lastSaved(layer).rows.slice(0, 2).map((r) => r.refId)).toEqual(["c1", "house"]));
    expect((screen.getByRole("button", { name: "Move New car up" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("a new change joins the list at the bottom, switched on", async () => {
    const layer = open(listed);
    fireEvent.click(await screen.findByRole("button", { name: "Add a cost" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name of the change"), { target: { value: "Gym" } });
    fireEvent.change(within(dialog).getByLabelText("Budget line"), { target: { value: "Gym" } });
    fireEvent.change(within(dialog).getByLabelText("Amount a month"), { target: { value: "50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add change" }));
    await waitFor(() => expect(lastSaved(layer).changes.map((c) => c.label)).toContain("Gym"));
    const saved = lastSaved(layer);
    const gym = saved.changes.find((c) => c.label === "Gym")!;
    expect(saved.rows[saved.rows.length - 1]).toMatchObject({ kind: "change", refId: gym.id, on: true });
  });

  test("no start months: the change form and the car form ask for none", async () => {
    const layer = open(listed);
    fireEvent.click(await screen.findByRole("button", { name: "Add a cost" }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("From")).toBeNull();
    expect(within(dialog).queryByLabelText("Until (optional)")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Name of the change"), { target: { value: "Gym" } });
    fireEvent.change(within(dialog).getByLabelText("Budget line"), { target: { value: "Gym" } });
    fireEvent.change(within(dialog).getByLabelText("Amount a month"), { target: { value: "50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add change" }));
    await waitFor(() => expect(lastSaved(layer).changes.some((c) => c.label === "Gym")).toBe(true));
    // Stored, never read: next month, open-ended.
    expect(lastSaved(layer).changes.find((c) => c.label === "Gym")).toMatchObject({ fromPeriod: addMonths(localDateIso().slice(0, 7), 1), untilPeriod: null });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Car" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("First payment")).toBeNull();
    // The list says no months either.
    expect((await screen.findAllByTestId("list-row")).some((r) => /from [A-Z][a-z]{2} \d{4}/.test(r.textContent ?? ""))).toBe(false);
  });

  test("the verdict sits at the top when the what-if has a salary, and follows the switches", async () => {
    const { salaryVerdict, verdictText, ladderGoalsFrom } = await import("../../src/domain/what-if");
    const w = { ...listed, salaryGrossAnnualCents: 12_000_000 };
    open(w);
    const nextMonth = addMonths(localDateIso().slice(0, 7), 1);
    const goals = ladderGoalsFrom([houseGoal, tripGoal], { accounts: [], balances: [], links: [], txns: [] }, localDateIso());
    const expectFor = (x: WhatIf) => verdictText(salaryVerdict(whatIfLadder(x, LINES, goals, nextMonth, DEFAULT_SALARY_ASSUMPTIONS), 12_000_000, DEFAULT_SALARY_ASSUMPTIONS, { whatIf: x, baseLines: LINES }));
    const verdict = await screen.findByTestId("whatif-verdict");
    expect(verdict.textContent).toContain(expectFor(w));
    expect(verdict.textContent).toMatch(/^\$120,000 /);
    fireEvent.click(switchFor("Saving for Family trip"));
    const on = { ...w, rows: [...w.rows, { kind: "goal-saving" as const, refId: "trip", position: 5, on: true }] };
    await waitFor(() => expect(screen.getByTestId("whatif-verdict").textContent).toContain(expectFor(on)));
    // The verdict comes before the list and the ladder on the page.
    const list = screen.getAllByTestId("list-row")[0];
    expect(verdict.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("a salary that falls short is said in red, with what it does not cover", async () => {
    open({ ...listed, salaryGrossAnnualCents: 6_000_000 });
    const verdict = await screen.findByTestId("whatif-verdict");
    expect(verdict.textContent).toMatch(/^\$60,000 is \$[\d,]+ a month short; it does not cover: /);
    expect(verdict.className).toMatch(/text-destructive/);
  });

  test("with no salary of its own and no yearly salary in Settings, there is no verdict", async () => {
    open(listed);
    await rowIds();
    expect(screen.queryByTestId("whatif-verdict")).toBeNull();
  });

  test("with no salary of its own, the current yearly salary is the one checked", async () => {
    const { layer } = fakeLayer({ rows: [offerRow], whatIfs: [listed] });
    layer.getSalarySettings = async () => ({ ...DEFAULT_SALARY_ASSUMPTIONS, currentSalary: { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "2026-11" } });
    renderScreen(layer);
    expect((await screen.findByTestId("whatif-verdict")).textContent).toMatch(/^Your current salary, \$120,000, /);
  });
});
