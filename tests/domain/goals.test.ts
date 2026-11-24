// tests/domain/goals.test.ts -- goal math.
// Every expected value below is worked by hand in the comment next to it, so
// a test never confirms whatever the code happens to return.
import { describe, expect, test } from "vitest";
import {
  GOAL_TEMPLATES,
  isGoalType,
  isGoalFundingAccount,
  goalFunding,
  accountFundingSummaries,
  goalThisMonthCents,
  goalStatus,
  formatProgressPct,
  goalsOverview,
  cardDebtCents,
  goalStatuses,
  goalTargetText,
} from "../../src/domain/goals";
import type { Goal, GoalAccountLink, AccountBalance } from "../../src/domain/plan-types";
import type { Account, NormalizedTxn } from "../../src/domain/types";

function acct(id: string, name: string, type: string | null, extra: Partial<Account> = {}): Account {
  return { id, name, type, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me", ...extra };
}
function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    name: "House",
    goalType: "home_down_payment",
    targetAmountCents: 1_000_000,
    targetDate: "2027-01-01",
    priority: 1,
    currentAmountCents: 0,
    plannedMonthlyCents: 0,
    notes: "",
    archivedAt: null,
    ...over,
  };
}
function txn(accountId: string, date: string, amountCents: number): NormalizedTxn {
  return { sourceTransactionId: `${accountId}-${date}-${amountCents}`, accountId, date, amountCents, sourceCategory: null, merchant: null, isTransfer: true, sourceUpdatedAt: null };
}

const ACCOUNTS: Account[] = [
  acct("acc-sav", "Savings", "savings"),
  acct("acc-brok", "Brokerage", "brokerage"),
  acct("acc-small", "Small cash", "depository"),
  acct("acc-nobal", "Never synced", "checking"),
  acct("acc-card", "Rewards Card", "credit"),
  acct("acc-loan", "Mortgage", "loan"),
  acct("acc-old", "Savings (legacy)", "savings", { archived: true }),
  acct("acc-untyped", "Mystery", null),
];
const BALANCES: AccountBalance[] = [
  { accountId: "acc-sav", balanceCents: 250_000, asOf: "2026-09-16T00:00:00Z" },
  { accountId: "acc-brok", balanceCents: 900_000, asOf: "2026-09-16T00:00:00Z" },
  { accountId: "acc-small", balanceCents: 10_000, asOf: "2026-09-16T00:00:00Z" },
  { accountId: "acc-card", balanceCents: -40_000, asOf: "2026-09-16T00:00:00Z" },
  { accountId: "acc-old", balanceCents: 999_999, asOf: "2026-09-16T00:00:00Z" },
];
const LINKS: GoalAccountLink[] = [
  { goalId: "g1", accountId: "acc-sav", mode: "entire", amountCents: null },
  { goalId: "g1", accountId: "acc-brok", mode: "fixed", amountCents: 50_000 },
  { goalId: "g2", accountId: "acc-brok", mode: "fixed", amountCents: 100_000 },
  { goalId: "g2", accountId: "acc-small", mode: "fixed", amountCents: 30_000 },
  { goalId: "g2", accountId: "acc-nobal", mode: "fixed", amountCents: 5_000 },
];

// --- templates and eligibility ------------------------------------------------

test("templates: eight goal templates, Savings is the blank custom one", () => {
  expect(GOAL_TEMPLATES.map((t) => t.type)).toEqual([
    "emergency_fund", "home_down_payment", "car", "vacation", "wedding", "education", "retirement", "savings",
  ]);
  expect(GOAL_TEMPLATES.find((t) => t.type === "savings")?.defaultName).toBe("");
  expect(GOAL_TEMPLATES.find((t) => t.type === "emergency_fund")?.defaultName).toBe("Emergency fund");
  expect(isGoalType("vacation")).toBe(true);
  expect(isGoalType("pay_off_debt")).toBe(false);
  expect(isGoalType(42)).toBe(false);
});

test("funding-eligible accounts: cash, brokerage, retirement yes; card, loan, archived, untyped no", () => {
  const eligible = ACCOUNTS.filter(isGoalFundingAccount).map((a) => a.id);
  expect(eligible).toEqual(["acc-sav", "acc-brok", "acc-small", "acc-nobal"]);
  expect(isGoalFundingAccount(acct("ira", "Roth IRA", "brokerage"))).toBe(true);
  expect(isGoalFundingAccount(acct("m", "HELOC", "mortgage"))).toBe(false);
});

// --- goalFunding ------------------------------------------------------------------

test("saved = outside amount + entire balance + fixed slices, other goals' links ignored", () => {
  const f = goalFunding(goal({ currentAmountCents: 100_000 }), LINKS, ACCOUNTS, BALANCES);
  // 100,000 outside + 250,000 (all of Savings) + 50,000 (slice of Brokerage) = 400,000
  expect(f.savedCents).toBe(400_000);
  expect(f.outsideCents).toBe(100_000);
  expect(f.byAccount).toEqual([
    { accountId: "acc-sav", accountName: "Savings", mode: "entire", cents: 250_000, balanceKnown: true },
    { accountId: "acc-brok", accountName: "Brokerage", mode: "fixed", cents: 50_000, balanceKnown: true },
  ]);
  expect(f.ignoredAccountIds).toEqual([]);
});

test("an archived, missing, or ineligible linked account contributes nothing and is reported", () => {
  const links: GoalAccountLink[] = [
    { goalId: "g1", accountId: "acc-old", mode: "entire", amountCents: null },
    { goalId: "g1", accountId: "acc-gone", mode: "fixed", amountCents: 70_000 },
    { goalId: "g1", accountId: "acc-card", mode: "entire", amountCents: null },
  ];
  const f = goalFunding(goal({ currentAmountCents: 1_500 }), links, ACCOUNTS, BALANCES);
  expect(f.savedCents).toBe(1_500);
  expect(f.byAccount).toEqual([]);
  expect(f.ignoredAccountIds).toEqual(["acc-old", "acc-gone", "acc-card"]);
});

test("an entire-balance account with no synced balance counts as 0 and says so", () => {
  const links: GoalAccountLink[] = [{ goalId: "g1", accountId: "acc-nobal", mode: "entire", amountCents: null }];
  const f = goalFunding(goal(), links, ACCOUNTS, BALANCES);
  expect(f.savedCents).toBe(0);
  expect(f.byAccount[0]).toMatchObject({ accountId: "acc-nobal", cents: 0, balanceKnown: false });
});

// --- accountFundingSummaries ---------------------------------------------------

test("per-account allocation: available = balance - slices; entire => 0 available; over-allocation flagged", () => {
  const s = accountFundingSummaries(ACCOUNTS, BALANCES, LINKS);
  expect(s.map((x) => x.account.id)).toEqual(["acc-sav", "acc-brok", "acc-small", "acc-nobal"]);
  const by = Object.fromEntries(s.map((x) => [x.account.id, x]));
  // Savings: entirely g1's. 250,000 allocated, nothing available.
  expect(by["acc-sav"]).toMatchObject({ balanceCents: 250_000, allocatedCents: 250_000, availableCents: 0, overAllocated: false, entireGoalId: "g1" });
  // Brokerage: 50,000 (g1) + 100,000 (g2) = 150,000 of 900,000 => 750,000 available.
  expect(by["acc-brok"]).toMatchObject({ balanceCents: 900_000, allocatedCents: 150_000, availableCents: 750_000, overAllocated: false, entireGoalId: null });
  // Small cash: 30,000 promised against a 10,000 balance => over-allocated, 0 available (never negative).
  expect(by["acc-small"]).toMatchObject({ balanceCents: 10_000, allocatedCents: 30_000, availableCents: 0, overAllocated: true });
  // Never synced: unknown balance is not "over-allocated", just unavailable.
  expect(by["acc-nobal"]).toMatchObject({ balanceCents: null, allocatedCents: 5_000, availableCents: 0, overAllocated: false });
});

test("a fixed slice on top of an entire-balance link is over-allocation", () => {
  const links: GoalAccountLink[] = [
    { goalId: "g1", accountId: "acc-sav", mode: "entire", amountCents: null },
    { goalId: "g2", accountId: "acc-sav", mode: "fixed", amountCents: 1 },
  ];
  const [sav] = accountFundingSummaries([ACCOUNTS[0]], BALANCES, links);
  expect(sav).toMatchObject({ allocatedCents: 250_001, availableCents: 0, overAllocated: true, entireGoalId: "g1" });
});

// --- goalThisMonthCents ------------------------------------------------------------

test("this month = net transactions on entire-balance accounts in that period only", () => {
  const f = goalFunding(goal(), LINKS, ACCOUNTS, BALANCES);
  const txns = [
    txn("acc-sav", "2026-09-03", 50_000),
    txn("acc-sav", "2026-09-20", -2_000),
    txn("acc-sav", "2026-08-30", 99_999), // last month
    txn("acc-brok", "2026-09-05", 70_000), // fixed slice: cannot be attributed to this goal
  ];
  // 50,000 - 2,000 = 48,000
  expect(goalThisMonthCents(f, txns, "2026-09")).toBe(48_000);
  expect(goalThisMonthCents(f, [], "2026-09")).toBe(0);
});

test("a goal with no entire-balance link has no this-month figure", () => {
  const f = goalFunding(goal({ id: "g2" }), LINKS, ACCOUNTS, BALANCES);
  expect(goalThisMonthCents(f, [txn("acc-brok", "2026-09-05", 70_000)], "2026-09")).toBeNull();
});

// --- goalStatus ------------------------------------------------------------------------
// Base case: target $10,000 by 2027-01-01, $4,000 saved, as of 2026-01-15.
// Months that can still take a contribution: Jan 2026 .. Jan 2027 = 13.

test("recommended monthly = remaining / months (current month through target month)", () => {
  const s = goalStatus(goal(), 400_000, "2026-01-15");
  expect(s.remainingCents).toBe(600_000);
  expect(s.monthsRemaining).toBe(13);
  expect(s.recommendedMonthlyCents).toBe(46_154); // ceil(600,000 / 13) = ceil(46,153.8)
  expect(s.progressPct).toBeCloseTo(0.4, 5);
  expect(s.status).toBe("no_plan"); // no planned contribution yet
  expect(s.forecastPeriod).toBeNull();
  expect(s.monthsUntilDone).toBeNull();
  expect(s.monthsVsTarget).toBeNull();
  expect(s.thisMonthCents).toBeNull();
});

test("The conservative rule: the current month is skipped once something was contributed in it", () => {
  const s = goalStatus(goal(), 400_000, "2026-01-15", 100);
  expect(s.recommendedMonthlyCents).toBe(50_000); // ceil(600,000 / 12)
  expect(s.thisMonthCents).toBe(100);
});

test("planned contribution projects the finish month and sets ahead / on track / at risk", () => {
  // $500/mo from Jan 2026: 12 contributions => done in Dec 2026, a month before the Jan 2027 target.
  const ahead = goalStatus(goal({ plannedMonthlyCents: 50_000 }), 400_000, "2026-01-15");
  expect(ahead.forecastPeriod).toBe("2026-12");
  expect(ahead.monthsUntilDone).toBe(11);
  expect(ahead.monthsVsTarget).toBe(-1);
  expect(ahead.status).toBe("ahead");

  // Same plan, but January already received a contribution: 12 more from Feb => Jan 2027, on track.
  const onTrack = goalStatus(goal({ plannedMonthlyCents: 50_000 }), 400_000, "2026-01-15", 50_000);
  expect(onTrack.forecastPeriod).toBe("2027-01");
  expect(onTrack.monthsUntilDone).toBe(12);
  expect(onTrack.monthsVsTarget).toBe(0);
  expect(onTrack.status).toBe("on_track");

  // The recommended amount lands exactly on the target month.
  const exact = goalStatus(goal({ plannedMonthlyCents: 46_154 }), 400_000, "2026-01-15");
  expect(exact.forecastPeriod).toBe("2027-01"); // ceil(600,000 / 46,154) = 13 contributions, Jan..Jan
  expect(exact.status).toBe("on_track");

  // $300/mo: ceil(600,000 / 30,000) = 20 contributions => Aug 2027, 7 months late.
  const late = goalStatus(goal({ plannedMonthlyCents: 30_000 }), 400_000, "2026-01-15");
  expect(late.forecastPeriod).toBe("2027-08");
  expect(late.monthsVsTarget).toBe(7);
  expect(late.status).toBe("at_risk");
});

// 100% saved reads Fully saved; Completed is Mark complete.
test("a goal at or over its target is fully saved, with nothing left to recommend", () => {
  const s = goalStatus(goal({ plannedMonthlyCents: 50_000 }), 1_000_000, "2026-01-15");
  expect(s.status).toBe("fully_saved");
  expect(s.remainingCents).toBe(0);
  expect(s.progressPct).toBe(1);
  expect(s.recommendedMonthlyCents).toBeNull();
  expect(s.forecastPeriod).toBeNull();
  expect(s.monthsUntilDone).toBe(0);
  const over = goalStatus(goal(), 1_250_000, "2026-01-15");
  expect(over.status).toBe("fully_saved");
  expect(over.progressPct).toBe(1); // clamped, never 125%
});

test("without a target date there is a forecast but no recommendation and no status", () => {
  const s = goalStatus(goal({ targetDate: null, plannedMonthlyCents: 50_000 }), 400_000, "2026-01-15");
  expect(s.monthsRemaining).toBeNull();
  expect(s.recommendedMonthlyCents).toBeNull();
  expect(s.forecastPeriod).toBe("2026-12");
  expect(s.monthsVsTarget).toBeNull();
  expect(s.status).toBe("no_plan");
});

test("a target date that has passed with money still to save is at risk, and the recommendation is the whole remainder", () => {
  // Target Jan 2026, now Jun 2026, $1,000 short, $500/mo planned: Jun + Jul => done Jul 2026, 6 months late.
  const s = goalStatus(goal({ targetDate: "2026-01-01", plannedMonthlyCents: 50_000 }), 900_000, "2026-06-01");
  expect(s.monthsRemaining).toBe(0);
  expect(s.recommendedMonthlyCents).toBe(100_000);
  expect(s.forecastPeriod).toBe("2026-07");
  expect(s.monthsVsTarget).toBe(6);
  expect(s.status).toBe("at_risk");
  // Even with no plan, a missed date is at risk, not "no plan".
  expect(goalStatus(goal({ targetDate: "2026-01-01" }), 900_000, "2026-06-01").status).toBe("at_risk");
});

test("a plan that would take more than 50 years yields no finish month and is at risk", () => {
  const s = goalStatus(goal({ plannedMonthlyCents: 1 }), 400_000, "2026-01-15");
  expect(s.forecastPeriod).toBeNull();
  expect(s.monthsUntilDone).toBeNull();
  expect(s.status).toBe("at_risk");
});

test("progress percent never reads 100% while the goal is short", () => {
  expect(formatProgressPct(0.4)).toBe("40%");
  expect(formatProgressPct(1)).toBe("100%");
  expect(formatProgressPct(0.99996)).toBe("99.99%");
  expect(formatProgressPct(0.995)).toBe("99.5%");
  expect(formatProgressPct(0.004)).toBe("0%");
  expect(formatProgressPct(-0.2)).toBe("0%");
  expect(formatProgressPct(1.7)).toBe("100%");
});

// --- goalsOverview -----------------------------------------------------------------

test("overview sums active goals only and available cash across eligible accounts", () => {
  const statuses = [
    goalStatus(goal(), 400_000, "2026-01-15"),
    goalStatus(goal({ id: "g2", targetAmountCents: 200_000, archivedAt: "2026-09-01T00:00:00Z" }), 50_000, "2026-01-15"),
  ];
  const summaries = accountFundingSummaries(ACCOUNTS, BALANCES, LINKS);
  const o = goalsOverview(statuses, summaries);
  expect(o).toEqual({
    savedCents: 400_000,
    targetCents: 1_000_000,
    availableForGoalsCents: 750_000, // Brokerage's 750,000; Savings 0, Small cash 0, Never synced 0
    retirementAvailableCents: 0,
    overAllocatedCount: 1, // Small cash
    activeCount: 1,
  });
});

test("card debt comes off what is available for goals (card balances always subtract)", () => {
  const debt = cardDebtCents(ACCOUNTS, BALANCES);
  expect(debt).toBe(40_000); // the fixture's card
  const o = goalsOverview([goalStatus(goal(), 400_000, "2026-01-15")], accountFundingSummaries(ACCOUNTS, BALANCES, LINKS), debt);
  expect(o.availableForGoalsCents).toBe(750_000 - 40_000);
});

test("more card debt than cash reads as zero available, never negative", () => {
  const o = goalsOverview([], accountFundingSummaries(ACCOUNTS, BALANCES, LINKS), 9_999_999);
  expect(o.availableForGoalsCents).toBe(0);
});

test("card debt counts the same whichever sign the feed reports it in, as Drawable does", () => {
  const owedAsPositive = BALANCES.map((b) => (b.accountId === "acc-card" ? { ...b, balanceCents: 40_000 } : b));
  expect(cardDebtCents(ACCOUNTS, owedAsPositive)).toBe(40_000);
});

test("an archived or switched-off card is not counted as debt", () => {
  const archived = { ...ACCOUNTS[0], id: "c1", type: "credit", archived: true } as Account;
  const off = { ...ACCOUNTS[0], id: "c2", type: "credit", includeInSpend: false } as Account;
  const balances = [{ accountId: "c1", balanceCents: -100 }, { accountId: "c2", balanceCents: -200 }] as AccountBalance[];
  expect(cardDebtCents([archived, off], balances)).toBe(0);
});

// The same dollars must never count in two goals.
test("goalLinkConflict: entire over another goal's slice, and a slice of another goal's entire balance, are refused", async () => {
  const { goalLinkConflict } = await import("../../src/domain/goals");
  const slice = { goalId: "a", accountId: "x", mode: "fixed" as const, amountCents: 30000 };
  const whole = { goalId: "b", accountId: "x", mode: "entire" as const, amountCents: null };
  // b wants x entirely while a slices it.
  expect(goalLinkConflict("b", [whole], [slice])).toMatch(/fixed amount of that account/);
  // a wants a slice of x while b holds it entirely.
  expect(goalLinkConflict("a", [slice], [whole])).toMatch(/already funds another goal/);
  // A goal's own existing links never conflict with its replacement.
  expect(goalLinkConflict("b", [whole], [whole])).toBeNull();
  // Two slices of one account from different goals are fine (the balance cap is separate).
  expect(goalLinkConflict("b", [{ ...slice, goalId: "b" }], [slice])).toBeNull();
  // Another account is never a conflict.
  expect(goalLinkConflict("b", [{ ...whole, accountId: "y" }], [slice])).toBeNull();
});

// The Goals screen and the Dashboard's Goals card compute a
// goal's status through this one function, so they can never disagree.
test("goalStatuses composes funding, this month and status the way each goal card does", () => {
  const g = goal();
  const [row] = goalStatuses([g], { accounts: ACCOUNTS, balances: BALANCES, links: LINKS, txns: [] }, "2026-01-15");
  const funding = goalFunding(g, LINKS, ACCOUNTS, BALANCES);
  expect(row.funding).toEqual(funding);
  expect(row.status).toEqual(goalStatus(g, funding.savedCents, "2026-01-15", goalThisMonthCents(funding, [], "2026-01")));
});

test("goalStatuses keeps one row per goal, archived ones included", () => {
  const rows = goalStatuses([goal(), goal({ id: "g2", archivedAt: "2026-02-01T00:00:00Z" })], { accounts: ACCOUNTS, balances: BALANCES, links: LINKS, txns: [] }, "2026-01-15");
  expect(rows.map((r) => r.status.goal.id)).toEqual(["g1", "g2"]);
});

// Having the money is not having bought the house.
describe("Fully saved versus Completed", () => {
  test("only Mark complete reads Completed, whatever is saved", () => {
    expect(goalStatus(goal({ completedAt: "2026-09-30T12:00:00.000Z" }), 10, "2026-09-30").status).toBe("completed");
  });
  test("a marked goal that is also fully saved still reads Completed", () => {
    expect(goalStatus(goal({ completedAt: "2026-09-30T12:00:00.000Z" }), 1_000_000, "2026-09-30").status).toBe("completed");
  });
});

// A goal leads with its savings target and date.
describe("goalTargetText", () => {
  test("the target and the month it is due", () => {
    expect(goalTargetText(goal({ targetAmountCents: 24_000_000, targetDate: "2030-09-01" }))).toBe("Save $240,000 by Sep 2030");
  });
  test("with no date, just the target", () => {
    expect(goalTargetText(goal({ targetAmountCents: 500_000, targetDate: null }))).toBe("Save $5,000");
  });
});

// A goal marked complete needs no more
// saving, even with nothing saved; What if must not ask $3,000 a month for it.
test("a goal marked complete recommends nothing more a month", () => {
  const s = goalStatus(goal({ targetAmountCents: 1_200_000, targetDate: "2026-12-01", completedAt: "2026-09-30T12:00:00.000Z" }), 0, "2026-09-30");
  expect(s.status).toBe("completed");
  expect(s.recommendedMonthlyCents).toBeNull();
});

// A down payment cannot come from an IRA
// without tax and a penalty, so retirement money is its own line, not part of
// the main figure. Retirement goals stay possible: the line is still shown.
test("Available for goals leaves retirement out of the main figure and shows it on its own", () => {
  const accounts = [acct("bro", "Brokerage (0606)", "brokerage"), acct("roth", "Roth IRA (0707)", "brokerage"), acct("k", "Plan (1)", "401k")];
  const balances: AccountBalance[] = [
    { accountId: "bro", balanceCents: 100_000, asOf: "2026-09-16" },
    { accountId: "roth", balanceCents: 50_000, asOf: "2026-09-16" },
    { accountId: "k", balanceCents: 20_000, asOf: "2026-09-16" },
  ];
  const o = goalsOverview([], accountFundingSummaries(accounts, balances, []), 10_000);
  expect(o.availableForGoalsCents).toBe(90_000);
  expect(o.retirementAvailableCents).toBe(70_000);
});
