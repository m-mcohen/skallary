// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, waitFor, fireEvent, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatPeriodLabel, localDateIso } from "../../src/domain/period";

import GoalsSection, { type GoalsDataLayer } from "../../src/ui/GoalsSection";
import { applyTemplate, draftFor, goalFromDraft } from "../../src/ui/goals/GoalDialog";
import { maxFixedCents } from "../../src/ui/goals/GoalAccountsDialog";
import { accountFundingSummaries } from "../../src/domain/goals";

// This repo's other UI tests (CategoryMappingDialog.test.tsx, BudgetGrid.test.tsx)
// don't call cleanup() because their per-test text/labels never collide within a
// file. Here several tests render cards for the same goal name/id, so without
// explicit cleanup the DOM from an earlier test lingers (vitest.config.ts has no
// `globals: true`) and later queries match more than one element.
afterEach(cleanup);
import type { Goal, GoalAccountLink, AccountBalance, WishlistItem } from "../../src/domain/plan-types";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { Db } from "../../src/ui/lib/db";

// $10,000 down payment by Jan 2030: $1,500 saved outside, all of Savings ($2,500)
// linked, $500/mo planned. Saved $4,000 = 40%; $6,000 left / $500 = 12
// contributions, finishing long before 2030 => Ahead.
const GOAL: Goal = {
  id: "g1",
  name: "House down payment",
  goalType: "home_down_payment",
  targetAmountCents: 1_000_000,
  targetDate: "2030-01-01",
  priority: 1,
  currentAmountCents: 150_000,
  plannedMonthlyCents: 50_000,
  notes: "",
  archivedAt: null,
};
function acct(id: string, name: string, type: string): Account {
  return { id, name, type, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" };
}
const ACCOUNTS: Account[] = [acct("acc-sav", "Savings", "savings"), acct("acc-brok", "Brokerage", "brokerage")];
const BALANCES: AccountBalance[] = [
  { accountId: "acc-sav", balanceCents: 250_000, asOf: "2026-09-16T00:00:00Z" },
  { accountId: "acc-brok", balanceCents: 900_000, asOf: "2026-09-16T00:00:00Z" },
];
const LINKS: GoalAccountLink[] = [{ goalId: "g1", accountId: "acc-sav", mode: "entire", amountCents: null }];

function makeStubDataLayer(opts: {
  goals?: Goal[];
  accounts?: Account[];
  balances?: AccountBalance[];
  links?: GoalAccountLink[];
  txns?: NormalizedTxn[];
  wish?: WishlistItem[];
} = {}) {
  let goals = [...(opts.goals ?? [])];
  let links = [...(opts.links ?? [])];
  const listGoals = vi.fn(async () => goals);
  // Always a fresh array, as the real fetch returns one: mutating in place
  // would hand React the same reference and skip the re-render.
  const upsertGoal = vi.fn(async (_db: Db, g: Goal) => {
    goals = goals.some((x) => x.id === g.id) ? goals.map((x) => (x.id === g.id ? g : x)) : [...goals, g];
  });
  const deleteGoal = vi.fn(async (_db: Db, id: string) => {
    goals = goals.filter((g) => g.id !== id);
    links = links.filter((l) => l.goalId !== id);
  });
  const listGoalAccountLinks = vi.fn(async () => links);
  const replaceGoalAccountLinks = vi.fn(async (_db: Db, goalId: string, next: GoalAccountLink[]) => {
    links = [...links.filter((l) => l.goalId !== goalId), ...next];
  });
  const dataLayer: Partial<GoalsDataLayer> = {
    loadDb: async () => ({}) as Db,
    listGoals,
    upsertGoal,
    deleteGoal,
    listWishlistItems: async () => opts.wish ?? [],
    getAccounts: async () => opts.accounts ?? [],
    getAccountBalances: async () => opts.balances ?? [],
    getTransactions: async () => opts.txns ?? [],
    listGoalAccountLinks,
    replaceGoalAccountLinks,
  };
  return { dataLayer, listGoals, upsertGoal, deleteGoal, replaceGoalAccountLinks };
}

const FUNDED = { goals: [GOAL], accounts: ACCOUNTS, balances: BALANCES, links: LINKS };

test("a goal card shows the saved amount from its linked balance, the status pill, the finish month and the funding lines", async () => {
  const { dataLayer } = makeStubDataLayer(FUNDED);
  const { findByText, getByText, getAllByText } = render(<GoalsSection dataLayer={dataLayer} />);

  await findByText("House down payment");
  await findByText("Ahead");
  // $1,500 outside + $2,500 Savings = $4,000, on the card and in the overview.
  // The savings target leads; the saved amount sits in the progress line.
  expect(getByText("Save $10,000 by Jan 2030")).toBeTruthy();
  expect(getByText("$4,000 saved, 40% of $10,000")).toBeTruthy();
  expect(getAllByText("$4,000")).toHaveLength(1); // the funding line
  expect(getByText("Down payment")).toBeTruthy(); // template label
  expect(getByText("Projected finish")).toBeTruthy();
  expect(getByText("Planned per month")).toBeTruthy();
  expect(getByText("$500")).toBeTruthy();
  expect(getByText(/entire balance/)).toBeTruthy();
  expect(getByText("Saved outside linked accounts")).toBeTruthy();
  expect(getByText("$1,500")).toBeTruthy();
});

test("Available for goals is the balance no goal has claimed: Brokerage's $9,000, none of the entirely-linked Savings", async () => {
  const { dataLayer } = makeStubDataLayer(FUNDED);
  const { findByText, getByText } = render(<GoalsSection dataLayer={dataLayer} />);
  await findByText("Available for goals");
  await findByText("$9,000");
  expect(getByText("Saved toward goals")).toBeTruthy();
  expect(getByText("of $10,000 targeted")).toBeTruthy();
});

test("Available for goals subtracts what is owed on cards, so it cannot read above net worth", async () => {
  const withCard = [...ACCOUNTS, acct("acc-card", "Rewards Card", "credit")];
  const balances = [...BALANCES, { accountId: "acc-card", balanceCents: -350_000, asOf: "2026-09-16T00:00:00Z" }];
  const { dataLayer } = makeStubDataLayer({ ...FUNDED, accounts: withCard, balances });
  const { findByText, queryByText } = render(<GoalsSection dataLayer={dataLayer} />);
  // Brokerage $9,000.00 less the $3,500.00 owed on the card = $5,500.00, shown as $5,500.
  await findByText("$5,500");
  expect(queryByText("$9,000")).toBeNull();
  await findByText("Cash and brokerage, less card balances and what goals already claim");
});

// Retirement money on its own line under the main figure.
test("Available for goals shows retirement accounts on their own line", async () => {
  const withIra = [...ACCOUNTS, acct("acc-ira", "Roth IRA", "brokerage")];
  const balances = [...BALANCES, { accountId: "acc-ira", balanceCents: 2_300_000, asOf: "2026-09-16T00:00:00Z" }];
  const { dataLayer } = makeStubDataLayer({ ...FUNDED, accounts: withIra, balances });
  const { findByText, findByTestId } = render(<GoalsSection dataLayer={dataLayer} />);
  await findByText("$9,000");
  expect((await findByTestId("goals-retirement-available")).textContent).toBe("Retirement accounts $23,000");
});

test("add goal: the template pre-fills the name, a blank date saves as null, dollars become cents", async () => {
  const { dataLayer, upsertGoal } = makeStubDataLayer();
  const { findByText, findByRole, getByText, getByLabelText } = render(<GoalsSection dataLayer={dataLayer} defaultDialogOpen />);

  await findByText("No goals yet");
  // The dialog opens in a portal a tick after the list; wait for it rather than assume it (it flaked under full-suite load).
  fireEvent.click(await findByRole("button", { name: "Use the Vacation template" }));
  expect((getByLabelText("Name") as HTMLInputElement).value).toBe("Vacation");
  fireEvent.change(getByLabelText("Name"), { target: { value: "Beach trip 2027" } });
  fireEvent.change(getByLabelText("Target amount"), { target: { value: "5000" } });
  fireEvent.change(getByLabelText("Planned per month"), { target: { value: "250" } });
  fireEvent.click(getByText("Save goal"));

  await waitFor(() => {
    expect(upsertGoal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "Beach trip 2027",
        goalType: "vacation",
        targetAmountCents: 500_000,
        targetDate: null,
        plannedMonthlyCents: 25_000,
        currentAmountCents: 0,
        archivedAt: null,
      })
    );
  });
  await findByText("Beach trip 2027");
});

test("the accounts dialog refuses a slice above what is available, then saves the goal's links replace-all", async () => {
  const { dataLayer, replaceGoalAccountLinks } = makeStubDataLayer(FUNDED);
  const { findByText, getByRole, getByLabelText, findAllByText } = render(<GoalsSection dataLayer={dataLayer} />);

  await findByText("House down payment");
  fireEvent.click(getByRole("button", { name: "Accounts for House down payment" }));
  await findByText("Accounts for House down payment");
  expect(getByRole("button", { name: "Savings: entire balance" }).getAttribute("aria-pressed")).toBe("true");

  fireEvent.click(getByRole("button", { name: "Brokerage: fixed amount" }));
  fireEvent.change(getByLabelText("Brokerage: fixed amount in dollars"), { target: { value: "20000" } });
  fireEvent.click(getByRole("button", { name: "Save accounts" }));
  await findByText("Brokerage: only $9,000.00 is available.");
  expect(replaceGoalAccountLinks).not.toHaveBeenCalled();

  fireEvent.change(getByLabelText("Brokerage: fixed amount in dollars"), { target: { value: "500" } });
  fireEvent.click(getByRole("button", { name: "Save accounts" }));
  await waitFor(() => {
    expect(replaceGoalAccountLinks).toHaveBeenCalledWith(expect.anything(), "g1", [
      { goalId: "g1", accountId: "acc-sav", mode: "entire", amountCents: null },
      { goalId: "g1", accountId: "acc-brok", mode: "fixed", amountCents: 50_000 },
    ]);
  });
  // The card re-reads the links: $4,000 + $500 slice.
  await findAllByText("$4,500");
});

test("archive asks first, then the goal leaves the active list and sits under Show archived goals", async () => {
  const { dataLayer, upsertGoal } = makeStubDataLayer(FUNDED);
  const { findByText, getByRole, getByText } = render(<GoalsSection dataLayer={dataLayer} />);

  await findByText("House down payment");
  fireEvent.click(getByRole("button", { name: "Archive House down payment" }));
  await findByText("Archive House down payment?");
  expect(upsertGoal).not.toHaveBeenCalled();

  fireEvent.click(getByRole("button", { name: "Archive goal" }));
  await waitFor(() => {
    expect(upsertGoal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "g1", archivedAt: expect.any(String) }));
  });
  await findByText("No active goals");
  fireEvent.click(getByText("Show archived goals (1)"));
  await findByText("Archived");
  expect(getByRole("button", { name: "Unarchive House down payment" })).toBeTruthy();
});

test("delete asks first and only the confirmation calls deleteGoal", async () => {
  const { dataLayer, deleteGoal } = makeStubDataLayer(FUNDED);
  const { findByText, getByRole } = render(<GoalsSection dataLayer={dataLayer} />);

  await findByText("House down payment");
  fireEvent.click(getByRole("button", { name: "Delete House down payment" }));
  await findByText("Delete House down payment?");
  expect(deleteGoal).not.toHaveBeenCalled();

  fireEvent.click(getByRole("button", { name: "Delete goal" }));
  await waitFor(() => {
    expect(deleteGoal).toHaveBeenCalledWith(expect.anything(), "g1");
  });
  await findByText("No goals yet");
});

test("a failed accounts load keeps the goals on screen, says so, and disables account linking", async () => {
  const { dataLayer } = makeStubDataLayer({ goals: [GOAL] });
  const { findByText, getByRole } = render(
    <GoalsSection dataLayer={{ ...dataLayer, getAccounts: async () => { throw new Error("boom"); } }} />
  );
  await findByText("House down payment");
  await findByText("Couldn't load accounts, so linked balances are missing.");
  expect((getByRole("button", { name: "Accounts for House down payment" }) as HTMLButtonElement).disabled).toBe(true);
});

test("renders a neutral empty state headlessly when the db is unreachable (no local server)", async () => {
  const dataLayer: Partial<GoalsDataLayer> = {
    loadDb: async () => {
      throw new Error("no local server");
    },
  };
  const { findByText } = render(<GoalsSection dataLayer={dataLayer} />);
  await findByText("Not connected");
});

test("Personal Wish List card shows the running total and the number of items", async () => {
  const items: WishlistItem[] = [
    { id: "w1", name: "Couch", costCents: 200000, kind: "wish", targetDate: null, priority: 1, planningCategory: null },
    { id: "p1", name: "Roof", costCents: 500000, kind: "planned", targetDate: "2026-10-01", priority: 0, planningCategory: null },
  ];
  const { dataLayer } = makeStubDataLayer({ goals: [GOAL], wish: items });
  const { findByText, getByText } = render(<GoalsSection dataLayer={dataLayer} />);
  await findByText("$7,000");
  expect(getByText("Personal Wish List")).toBeTruthy();
  // The Wish List has no planned or wish kind any more.
  expect(getByText("2 items")).toBeTruthy();
});

test("a wish list load failure shows in the card and goals still render", async () => {
  const { dataLayer } = makeStubDataLayer({ goals: [GOAL] });
  const { findByText } = render(
    <GoalsSection dataLayer={{ ...dataLayer, listWishlistItems: async () => { throw new Error("boom"); } }} />
  );
  await findByText("Couldn't load the wish list.");
  await findByText("House down payment");
});

// --- dialog helpers (pure) ----------------------------------------------------------

test("applyTemplate pre-fills a blank or default name but never a typed one", () => {
  const blank = draftFor(null);
  expect(applyTemplate(blank, "emergency_fund").name).toBe("Emergency fund");
  const switched = applyTemplate(applyTemplate(blank, "emergency_fund"), "car");
  expect(switched.name).toBe("New car");
  const typed = { ...applyTemplate(blank, "car"), name: "Family minivan" };
  expect(applyTemplate(typed, "vacation")).toMatchObject({ goalType: "vacation", name: "Family minivan" });
});

test("goalFromDraft: blank date is null, blank planned is 0, a zero target is refused", () => {
  const draft = { ...draftFor(null), name: "Fund", targetDollars: "1,200.50", targetDate: "", plannedDollars: "", outsideDollars: "" };
  const built = goalFromDraft(draft, null);
  expect("goal" in built && built.goal).toMatchObject({ targetAmountCents: 120_050, targetDate: null, plannedMonthlyCents: 0, currentAmountCents: 0 });
  expect(goalFromDraft({ ...draft, targetDollars: "0" }, null)).toEqual({ error: "Target amount must be greater than zero." });
  expect(goalFromDraft({ ...draft, targetDate: "soon" }, null)).toEqual({ error: "Target date must be a date (YYYY-MM-DD) or blank." });
  // Editing keeps the id and the archived flag.
  const edited = goalFromDraft({ ...draftFor(GOAL), name: "Renamed" }, { ...GOAL, archivedAt: "2026-09-01T00:00:00Z" });
  expect("goal" in edited && edited.goal).toMatchObject({ id: "g1", name: "Renamed", archivedAt: "2026-09-01T00:00:00Z" });
});

test("maxFixedCents is the balance less other goals' slices, and unknown when there is no balance", () => {
  const links: GoalAccountLink[] = [
    { goalId: "g1", accountId: "acc-brok", mode: "fixed", amountCents: 50_000 },
    { goalId: "g2", accountId: "acc-brok", mode: "fixed", amountCents: 100_000 },
  ];
  const [, brok] = accountFundingSummaries(ACCOUNTS, BALANCES, links);
  expect(maxFixedCents(brok, "g1", links)).toBe(800_000); // 900,000 - g2's 100,000; g1's own slice does not count against it
  const [noBal] = accountFundingSummaries([acct("acc-x", "X", "savings")], [], []);
  expect(maxFixedCents(noBal, "g1", [])).toBeNull();
});

// The dialog's payment helper reads today's rate through the Goals screen's data layer.
test("Work out the payment asks the data layer for today's rate and shows it", async () => {
  const getMortgageRates = vi.fn(async () => ({ thirtyYear: { ratePct: 6.5, weekOf: "2026-03-12" }, fifteenYear: { ratePct: 5.75, weekOf: "2026-03-12" } }));
  const dataLayer = { ...makeStubDataLayer(), getMortgageRates };
  const { findByRole, findByDisplayValue } = render(<GoalsSection dataLayer={dataLayer} defaultDialogOpen />);
  fireEvent.click(await findByRole("button", { name: "Work out the payment" }));
  expect(await findByDisplayValue("6.5")).toBeTruthy();
  expect(getMortgageRates).toHaveBeenCalledTimes(1);
});

describe("Start this cost and Mark complete", () => {
  const ma = { id: "ma", name: "Swim lessons", goalType: "savings", targetAmountCents: 24000, targetDate: null, priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null, ongoingMonthlyCents: 20000, ongoingStartedPeriod: null, ongoingBudgetLine: null, completedAt: null } as Goal;
  const trip = { ...ma, id: "trip", name: "Trip", ongoingMonthlyCents: 0 } as Goal;
  const lines = [{ planId: "p", planningCategory: "Fitness", period: null, amountCents: 5000 }, { planId: "p", planningCategory: "Paychecks", period: null, amountCents: 900000 }, { planId: "p", planningCategory: "Investing", period: null, amountCents: 100000 }];
  // The dialog names this month, read the same way the app reads it.
  const thisMonth = formatPeriodLabel(localDateIso().slice(0, 7));

  const setup = (goals: Goal[], setGoalState = vi.fn(async () => {})) => {
    const onBudgetChanged = vi.fn();
    const dataLayer = { ...makeStubDataLayer({ goals }), setGoalState, getBudgetLines: async () => lines };
    render(<GoalsSection dataLayer={dataLayer} planId="p" onBudgetChanged={onBudgetChanged} />);
    return { setGoalState, onBudgetChanged, user: userEvent.setup() };
  };

  test("Start this cost asks once, with a new line named after the goal, and sends it", async () => {
    const { setGoalState, onBudgetChanged, user } = setup([ma]);
    await user.click(await screen.findByRole("button", { name: "Start this cost for Swim lessons" }));
    expect(await screen.findByText(`Add Swim lessons $200 a month to your budget, starting ${thisMonth}?`)).toBeTruthy();
    expect((screen.getByLabelText("Budget line name") as HTMLInputElement).value).toBe("Swim lessons");
    await user.click(screen.getByRole("button", { name: "Add to budget" }));
    await waitFor(() => expect(setGoalState).toHaveBeenCalledWith(expect.anything(), "ma", { startCost: { planId: "p", line: "Swim lessons", mode: "new" } }));
    await waitFor(() => expect(onBudgetChanged).toHaveBeenCalled());
  });

  test("an existing line can be picked instead", async () => {
    const { setGoalState, user } = setup([ma]);
    await user.click(await screen.findByRole("button", { name: "Start this cost for Swim lessons" }));
    await user.click(await screen.findByRole("radio", { name: "Add to an existing line" }));
    // Income and saving lines are not offered.
    expect([...(screen.getByLabelText("Existing budget line") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["Fitness"]);
    await user.selectOptions(screen.getByLabelText("Existing budget line"), "Fitness");
    await user.click(screen.getByRole("button", { name: "Add to budget" }));
    await waitFor(() => expect(setGoalState).toHaveBeenCalledWith(expect.anything(), "ma", { startCost: { planId: "p", line: "Fitness", mode: "existing" } }));
  });

  test("Mark complete with a planned cost: Add to budget completes and starts it", async () => {
    const { setGoalState, user } = setup([ma]);
    await user.click(await screen.findByRole("button", { name: "Mark Swim lessons complete" }));
    await user.click(await screen.findByRole("button", { name: "Add to budget" }));
    await waitFor(() => expect(setGoalState).toHaveBeenCalledWith(expect.anything(), "ma", { completed: true, startCost: { planId: "p", line: "Swim lessons", mode: "new" } }));
  });

  test("Mark complete with a planned cost: Not now only completes it", async () => {
    const { setGoalState, onBudgetChanged, user } = setup([ma]);
    await user.click(await screen.findByRole("button", { name: "Mark Swim lessons complete" }));
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(setGoalState).toHaveBeenCalledWith(expect.anything(), "ma", { completed: true }));
    expect(onBudgetChanged).not.toHaveBeenCalled();
  });

  // The existing-line wording.
  test("picking an existing line rewords the question around that line", async () => {
    const { user } = setup([ma]);
    await user.click(await screen.findByRole("button", { name: "Start this cost for Swim lessons" }));
    await user.click(await screen.findByRole("radio", { name: "Add to an existing line" }));
    expect(await screen.findByText(`Add $200 a month to your Fitness line, starting ${thisMonth}?`)).toBeTruthy();
    expect(screen.queryByText(/Add Fitness \$200/)).toBeNull();
  });

  // A visible Cancel; Escape means cancel.
  test("Cancel on Mark complete writes nothing: the goal is not completed", async () => {
    const { setGoalState, onBudgetChanged, user } = setup([ma]);
    await user.click(await screen.findByRole("button", { name: "Mark Swim lessons complete" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Add to budget" })).toBeNull());
    expect(setGoalState).not.toHaveBeenCalled();
    expect(onBudgetChanged).not.toHaveBeenCalled();
  });

  test("Escape on Mark complete writes nothing either", async () => {
    const { setGoalState, user } = setup([ma]);
    await user.click(await screen.findByRole("button", { name: "Mark Swim lessons complete" }));
    await screen.findByRole("button", { name: "Add to budget" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Add to budget" })).toBeNull());
    expect(setGoalState).not.toHaveBeenCalled();
  });

  test("Start this cost offers Cancel too, and no second way to do nothing", async () => {
    const { setGoalState, user } = setup([ma]);
    await user.click(await screen.findByRole("button", { name: "Start this cost for Swim lessons" }));
    await screen.findByRole("button", { name: "Add to budget" });
    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Add to budget" })).toBeNull());
    expect(setGoalState).not.toHaveBeenCalled();
  });

  test("Mark complete on a goal without a cost completes at once, with no question", async () => {
    const { setGoalState, user } = setup([trip]);
    await user.click(await screen.findByRole("button", { name: "Mark Trip complete" }));
    await waitFor(() => expect(setGoalState).toHaveBeenCalledWith(expect.anything(), "trip", { completed: true }));
    expect(screen.queryByRole("button", { name: "Add to budget" })).toBeNull();
  });

  test("Unmark complete says the budget line stays, and leaves it", async () => {
    const started = { ...ma, completedAt: "2026-10-01T00:00:00.000Z", ongoingStartedPeriod: "2026-10", ongoingBudgetLine: "Swim lessons" } as Goal;
    const { setGoalState, user } = setup([started]);
    await user.click(await screen.findByRole("button", { name: "Unmark Swim lessons complete" }));
    expect(await screen.findByText("Its budget line, Swim lessons, stays. Remove it on the Budget screen if you no longer have this cost.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Unmark complete" }));
    await waitFor(() => expect(setGoalState).toHaveBeenCalledWith(expect.anything(), "ma", { completed: false }));
  });

  test("a refusal shows the server's words and keeps the dialog open", async () => {
    const refusal = "There is already a budget line called Fitness. Pick it under Add to an existing line, or choose another name.";
    const { user } = setup([ma], vi.fn(async () => { throw new Error(refusal); }));
    await user.click(await screen.findByRole("button", { name: "Start this cost for Swim lessons" }));
    await user.clear(await screen.findByLabelText("Budget line name"));
    await user.type(screen.getByLabelText("Budget line name"), "Fitness");
    await user.click(screen.getByRole("button", { name: "Add to budget" }));
    expect(await screen.findByText(refusal)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add to budget" })).toBeTruthy();
  });
});

// The top bar and Runway read goals once, so every goal change must tell them,
// or a what-if keeps an old cost there.
describe("goal changes are reported", () => {
  const g = { id: "g1", name: "House", goalType: "savings", targetAmountCents: 100000, targetDate: null, priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null, ongoingMonthlyCents: 0, ongoingStartedPeriod: null, ongoingBudgetLine: null, completedAt: null } as Goal;
  const setup = (goals: Goal[]) => {
    const onGoalsChanged = vi.fn();
    const dataLayer = { ...makeStubDataLayer({ goals }), setGoalState: vi.fn(async () => {}), getBudgetLines: async () => [] };
    render(<GoalsSection dataLayer={dataLayer} planId="p" onGoalsChanged={onGoalsChanged} />);
    return { onGoalsChanged, user: userEvent.setup() };
  };
  test("after an edit is saved", async () => {
    const { onGoalsChanged, user } = setup([g]);
    await user.click(await screen.findByRole("button", { name: "Edit House" }));
    await user.click(await screen.findByRole("button", { name: "Save goal" }));
    await waitFor(() => expect(onGoalsChanged).toHaveBeenCalled());
  });
  test("after archiving", async () => {
    const { onGoalsChanged, user } = setup([g]);
    await user.click(await screen.findByRole("button", { name: "Archive House" }));
    await user.click(await screen.findByRole("button", { name: "Archive goal" }));
    await waitFor(() => expect(onGoalsChanged).toHaveBeenCalled());
  });
  test("after deleting", async () => {
    const { onGoalsChanged, user } = setup([g]);
    await user.click(await screen.findByRole("button", { name: "Delete House" }));
    await user.click(await screen.findByRole("button", { name: "Delete goal" }));
    await waitFor(() => expect(onGoalsChanged).toHaveBeenCalled());
  });
  test("after Mark complete", async () => {
    const { onGoalsChanged, user } = setup([g]);
    await user.click(await screen.findByRole("button", { name: "Mark House complete" }));
    await waitFor(() => expect(onGoalsChanged).toHaveBeenCalled());
  });
});
