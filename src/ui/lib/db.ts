// src/ui/lib/db.ts
//
// HTTP data layer. The renderer talks to the Node server (server/index.ts)
// over relative `/api/...` fetches, which Vite's dev-server proxy forwards to
// it (see vite.config.ts's `server.proxy`) and which the production build
// serves same-origin. Until Plan 4 this was a direct Tauri SQL connection;
// the function names and return types were kept so the UI did not change.
// The pure domain functions (rollupMonthly, buildForecast,
// resolveMonthlyPlan, ...) still run in the renderer over the plain objects
// these return.
//
// Mirrors src/data/repo.node.ts's column mapping (snake_case DB <-> camelCase
// domain) and its ''<->null budget-line period boundary: the DB column
// `budget_lines.period` is NOT NULL DEFAULT '' (a bare TEXT column can't carry
// SQL NULL through the UNIQUE(plan_id, planning_category, period) constraint
// the way we want default-vs-override rows to collide), while the domain
// model represents "applies to every month" as `period === null`. That
// translation happens entirely server-side (repo.node.ts, via
// server/services/readService.ts) -- this file never reimplements it.
//
// Consolidated the former src/data/repo.tauri.ts read helpers (getTransactions,
// getAccounts, getCategoryMappings) so there is a single in-app read/write path.
import type { NormalizedTxn, Account } from "../../domain/types";
import type { Plan, BudgetLine, Goal, GoalAccountLink, WishlistItem, AccountBalance, BalanceReading, BudgetChange, BigMonth, MonthNote } from "../../domain/plan-types";
import type { LineSuggestion } from "../../domain/suggest";
import type { TransactionAdjustment } from "../../domain/adjustments";
import type { CategorizationRule } from "../../domain/rules";
import type { Scenario } from "../../domain/scenario";
import type { WhatIf } from "../../domain/what-if";
import type { BudgetNote, SnapshotHistoryEntry, DataQualityFlag } from "../../domain/notes-types";
import type { CategorySetting } from "../../domain/category-settings";
import type { RecurringChoice, RecurringChoiceInput } from "../../domain/recurring-choices";
import type { CategorizationLogEntry, FilingInput, TransactionNote } from "../../domain/categorizations";
import type { MaaserMark, MaaserMarkInput } from "../../domain/maaser-marks";
import type { MerchantRename, MerchantRenameInput, SuggestionDismissal } from "../../domain/merchants";
import type { SalaryAssumptions } from "../../domain/salary";
import type { IncomeSettings } from "../../domain/income";
import { rememberPotForHelp } from "../../help/household-words";

// A marker handle, not a live connection. loadDb() once opened the Tauri
// SQL database. Callers only ever thread this value through to the `*UI`
// functions below, so a plain object satisfies every call site
// (`const db = await loadDb()`) without change.
export type Db = { base: string };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/**
 * Like `api`, but a 404 yields `fallback` instead of throwing. For reads whose
 * route may not exist yet: the UI ships ahead of the server, and a missing
 * endpoint has to read as "nothing known" rather than take the head down.
 */
export async function apiOr404<T>(path: string, fallback: T): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "same-origin", headers: { "Content-Type": "application/json" } });
  if (res.status === 404) return fallback;
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function loadDb(): Promise<Db> {
  return { base: "/api" };
}

export async function getTransactionsUI(db: Db): Promise<NormalizedTxn[]> {
  void db;
  return api<NormalizedTxn[]>("/transactions");
}

export async function getAccountsUI(db: Db): Promise<Account[]> {
  void db;
  return api<Account[]>("/accounts");
}

// Accounts management. Mirrors readService's getAccountsManage/setAccountOwner/
// setAccountInclude (the include-partner setting is in db-setup.ts). getAccountsManageUI returns
// the RAW account list (owner + un-rewritten includeInSpend); GET
// /api/accounts (getAccountsUI above) stays the effective/calc-facing list.
export async function getAccountsManageUI(db: Db): Promise<Account[]> {
  void db;
  return api<Account[]>("/accounts/manage");
}

export async function setAccountOwnerUI(db: Db, id: string, owner: Account["owner"]): Promise<void> {
  void db;
  await api<void>(`/accounts/${encodeURIComponent(id)}/owner`, {
    method: "POST",
    body: JSON.stringify({ owner }),
  });
}

export async function setAccountIncludeUI(db: Db, id: string, includeInSpend: boolean): Promise<void> {
  void db;
  await api<void>(`/accounts/${encodeURIComponent(id)}/include`, {
    method: "POST",
    body: JSON.stringify({ includeInSpend }),
  });
}

/**
 * Hides a superseded account record (the legacy Monarch row the SimpleFIN
 * cutover left behind). The account keeps its transactions, which still count
 * everywhere; its balance stops counting toward drawable, net worth and goals.
 */
export async function setAccountArchivedUI(db: Db, id: string, archived: boolean): Promise<void> {
  void db;
  await api<void>(`/accounts/${encodeURIComponent(id)}/archived`, {
    method: "POST",
    body: JSON.stringify({ archived }),
  });
}

/**
 * Where money put away in this account lands: 'Investing', 'Retirement', or
 * null for an ordinary spending or cash account. Money crossing INTO a flagged
 * account from an unflagged one counts as saving; the account's own internal
 * rows count nowhere.
 */
export async function setAccountSavingsDestinationUI(db: Db, id: string, savingsDestination: string | null): Promise<void> {
  void db;
  await api<void>(`/accounts/${encodeURIComponent(id)}/savings-destination`, {
    method: "POST",
    body: JSON.stringify({ savingsDestination }),
  });
}

// The "This page answers" line's on/off switch.
// apiOr404, like getSeedStatusUI: the UI ships ahead of the server, and a
// missing route has to read as the setting's own default (shown) rather than
// throw.
export async function getShowGuideLinesUI(db: Db): Promise<boolean> {
  void db;
  const { show } = await apiOr404<{ show: boolean }>("/settings/guide", { show: true });
  return show;
}

export async function setShowGuideLinesUI(db: Db, show: boolean): Promise<void> {
  void db;
  await api<void>("/settings/guide", { method: "POST", body: JSON.stringify({ show }) });
}

/**
 * "Name old Zelle payments by the person in the note".
 * Off by default, and off when the server is older than the screen (404).
 */
export async function getZelleMemoNamesUI(db: Db): Promise<boolean> {
  void db;
  const { on } = await apiOr404<{ on: boolean }>("/settings/zelle-names", { on: false });
  return on === true;
}

export async function setZelleMemoNamesUI(db: Db, on: boolean): Promise<void> {
  void db;
  await api<void>("/settings/zelle-names", { method: "POST", body: JSON.stringify({ on }) });
}

/** The floor kept in the pot account; nothing until it is typed, and nothing on an older server. */
export async function getMaaserFloorUI(db: Db): Promise<number> {
  void db;
  const { floorCents } = await apiOr404<{ floorCents: number }>("/settings/maaser-floor", { floorCents: 0 });
  return floorCents;
}

export async function setMaaserFloorUI(db: Db, floorCents: number): Promise<void> {
  void db;
  await api<void>("/settings/maaser-floor", { method: "POST", body: JSON.stringify({ floorCents }) });
}

// ---------------------------------------------------------------------------
// Everything below kept the name and return type it had under the old
// Tauri SQL layer; the bodies now `fetch` (via the `api<T>` helper above)
// against the Node server's `/api/...`
// routes (server/api/routes.ts -> server/services/readService.ts ->
// FinanceRepository -> NodeRepository, src/data/repo.node.ts). Same column
// mapping, same ''<->null budget-line period boundary, same integer cents --
// all of that lives server-side in repo.node.ts and is not reimplemented
// here.
// ---------------------------------------------------------------------------

export async function getCategoryMappingsUI(db: Db): Promise<Record<string, string>> {
  void db;
  return api<Record<string, string>>("/category-mappings");
}

// Mirrors repo.node.ts's NodeRepository.setCategoryMapping(): an upsert keyed on the
// table's UNIQUE(source_category) constraint.
export async function setCategoryMappingUI(
  db: Db,
  sourceCategory: string,
  planningCategory: string
): Promise<void> {
  void db;
  await api<void>("/category-mappings", {
    method: "POST",
    body: JSON.stringify({ source: sourceCategory, planning: planningCategory }),
  });
}

export async function getPlanUI(db: Db, id: string): Promise<Plan | null> {
  void db;
  return api<Plan | null>(`/plans/${encodeURIComponent(id)}`);
}

// P9: the grid needs a plan picker, which App.tsx's single-`getPlanUI(id)` read
// can't supply on its own (P8 flagged this gap). Mirrors repo.node.ts's
// listPlans().
export async function listPlansUI(db: Db): Promise<Plan[]> {
  void db;
  return api<Plan[]>("/plans");
}

export async function getBudgetLinesUI(db: Db, planId: string): Promise<BudgetLine[]> {
  void db;
  return api<BudgetLine[]>(`/plans/${encodeURIComponent(planId)}/budget-lines`);
}

/**
 * A Budget write whose refusal the reader must see in the server's own plain words
 * ("Months before this month are locked."), not "API ... failed: 400".
 */
async function apiShowingRefusal<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...init });
  if (res.ok) return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  let message = `API ${path} failed: ${res.status}`;
  try {
    const json = (await res.json()) as { error?: string };
    if (json?.error) message = json.error;
  } catch {
    // Not JSON; keep the status message.
  }
  throw new Error(message);
}

// Budget changes, big months and notes.
export async function getBudgetExtrasUI(db: Db, planId: string): Promise<{ changes: BudgetChange[]; bigMonths: BigMonth[]; notes: MonthNote[] }> {
  void db;
  return api(`/plans/${encodeURIComponent(planId)}/budget-extras`);
}
export async function changeBudgetLineUI(db: Db, planId: string, line: string, fromMonth: string | null, amountCents: number): Promise<{ replaced: BudgetChange[] }> {
  void db;
  return apiShowingRefusal(`/plans/${encodeURIComponent(planId)}/lines/${encodeURIComponent(line)}/change`, { method: "POST", body: JSON.stringify({ fromMonth, amountCents }) });
}
export async function resetBudgetLineUI(db: Db, planId: string, line: string): Promise<{ cleared: BudgetChange[]; kept: BudgetChange[]; suggestion: LineSuggestion }> {
  void db;
  return apiShowingRefusal(`/plans/${encodeURIComponent(planId)}/lines/${encodeURIComponent(line)}/reset`, { method: "POST", body: "{}" });
}
export async function getLineSuggestionUI(db: Db, planId: string, line: string): Promise<LineSuggestion> {
  void db;
  return api(`/plans/${encodeURIComponent(planId)}/lines/${encodeURIComponent(line)}/suggestion`);
}
export async function addBigMonthUI(db: Db, planId: string, b: Pick<BigMonth, "planningCategory" | "month" | "label" | "amountCents">): Promise<BigMonth> {
  void db;
  return apiShowingRefusal(`/plans/${encodeURIComponent(planId)}/big-months`, { method: "POST", body: JSON.stringify(b) });
}
export async function updateBigMonthUI(db: Db, id: number, b: Pick<BigMonth, "planningCategory" | "month" | "label" | "amountCents">): Promise<void> {
  void db;
  await apiShowingRefusal<void>(`/big-months/${id}`, { method: "PUT", body: JSON.stringify(b) });
}
export async function deleteBigMonthUI(db: Db, id: number): Promise<void> {
  void db;
  await apiShowingRefusal<void>(`/big-months/${id}`, { method: "DELETE" });
}
export async function setMonthNoteUI(db: Db, planId: string, line: string, month: string, note: string): Promise<void> {
  void db;
  await apiShowingRefusal<void>(`/plans/${encodeURIComponent(planId)}/month-notes`, { method: "PUT", body: JSON.stringify({ planningCategory: line, month, note }) });
}

// Set up budget and next year's budget.
export async function getSetupUI(db: Db, planId: string): Promise<{ suggestions: LineSuggestion[] }> {
  void db;
  return api(`/plans/${encodeURIComponent(planId)}/setup`);
}
export async function applySetupUI(db: Db, planId: string, lines: { line: string; amountCents: number }[]): Promise<{ applied: number; cleared: BudgetChange[] }> {
  void db;
  return apiShowingRefusal(`/plans/${encodeURIComponent(planId)}/apply-setup`, { method: "POST", body: JSON.stringify({ lines }) });
}
export async function startNextYearUI(
  db: Db,
  fromPlanId: string,
  lines: { line: string; amountCents: number; source: "you" | "suggested" }[],
): Promise<{ plan: Plan }> {
  void db;
  return apiShowingRefusal(`/plans/next-year`, { method: "POST", body: JSON.stringify({ fromPlanId, lines }) });
}

// --- Seed cadence and trailing spend --------------------------------------
// Mirrors GET /api/settings/seed and GET /api/trailing. Both tolerate the
// route not existing (404 -> neutral value). Neither takes a plan: the seed
// date is a setting and trailing spend is actuals, so the head can show both
// before a plan is picked instead of printing $0 as if it were a figure.

export interface SeedStatus {
  /** ISO timestamp of the last budget seed; null when never seeded. */
  lastSeedAt: string | null;
  windowMonths: number | null;
  /** ISO date (YYYY-MM-DD) the next re-seed falls due. */
  reseedDueAt: string | null;
  reseedDue: boolean;
}

export async function getSeedStatusUI(db: Db): Promise<SeedStatus> {
  void db;
  return apiOr404<SeedStatus>("/settings/seed", {
    lastSeedAt: null,
    windowMonths: null,
    reseedDueAt: null,
    reseedDue: false,
  });
}

export interface TrailingSummary {
  months: number;
  window: string[];
  /** Total expense over the window, positive cents. */
  totalCents: number;
  /** Average monthly expense over the window, positive cents. */
  monthlyAverageCents: number;
}

export async function getTrailingUI(db: Db, months = 12): Promise<TrailingSummary> {
  void db;
  return apiOr404<TrailingSummary>(`/trailing?months=${months}`, {
    months,
    window: [],
    totalCents: 0,
    monthlyAverageCents: 0,
  });
}

// Goals: mirrors repo.node.ts upsertGoal, listGoals, deleteGoal
export async function listGoalsUI(db: Db): Promise<Goal[]> {
  void db;
  return api<Goal[]>("/goals");
}

/**
 * A write whose refusal the reader must see in the server's own plain words
 * ("Ongoing cost a month cannot be negative."), not "API /goals failed: 400".
 */
async function postShowingRefusal(path: string, body: unknown): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return;
  let message = `API ${path} failed: ${res.status}`;
  try {
    const json = (await res.json()) as { error?: string };
    if (json?.error) message = json.error;
  } catch {
    // Not JSON; keep the status message.
  }
  throw new Error(message);
}

export async function upsertGoalUI(db: Db, g: Goal): Promise<void> {
  void db;
  await postShowingRefusal("/goals", g);
}

/** What Mark complete, Unmark complete and Start this cost send. */
export interface GoalStateChange {
  completed?: boolean;
  startCost?: { planId: string; line: string; mode: "new" | "existing" };
}

export async function setGoalStateUI(db: Db, goalId: string, change: GoalStateChange): Promise<void> {
  void db;
  await postShowingRefusal(`/goals/${encodeURIComponent(goalId)}/state`, change);
}

export async function deleteGoalUI(db: Db, id: string): Promise<void> {
  void db;
  await api<void>(`/goals/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// Goal account links (0018): mirrors repo.node.ts listGoalAccountLinks, replaceGoalAccountLinks.
// A refused replace (400/404/409) carries the server's plain-language message.
export async function listGoalAccountLinksUI(db: Db): Promise<GoalAccountLink[]> {
  void db;
  return api<GoalAccountLink[]>("/goal-links");
}

export async function replaceGoalAccountLinksUI(db: Db, goalId: string, links: GoalAccountLink[]): Promise<void> {
  void db;
  const res = await fetch(`/api/goals/${encodeURIComponent(goalId)}/links`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(links),
  });
  if (!res.ok) {
    let message = `API /goals/${goalId}/links failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // Not JSON; keep the status message.
    }
    throw new Error(message);
  }
}

// Wishlist items: mirrors repo.node.ts upsertWishlistItem, listWishlistItems, deleteWishlistItem
export async function listWishlistItemsUI(db: Db): Promise<WishlistItem[]> {
  void db;
  return api<WishlistItem[]>("/wishlist");
}

export async function upsertWishlistItemUI(db: Db, w: WishlistItem): Promise<void> {
  void db;
  await api<void>("/wishlist", { method: "POST", body: JSON.stringify(w) });
}

export async function deleteWishlistItemUI(db: Db, id: string): Promise<void> {
  void db;
  await api<void>(`/wishlist/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Save the Wish List's order, top first. A refusal carries the server's plain-words reason. */
export async function reorderWishlistUI(db: Db, ids: string[]): Promise<void> {
  void db;
  const res = await fetch("/api/wishlist/order", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (res.ok) return;
  let reason = `Could not save the order (${res.status}).`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) reason = body.error;
  } catch {
    // Not JSON: keep the status line.
  }
  throw new Error(reason);
}

// Account balances: mirrors repo.node.ts getAccountBalances
export async function getAccountBalancesUI(db: Db): Promise<AccountBalance[]> {
  void db;
  return api<AccountBalance[]>("/account-balances");
}

export async function listBalanceReadingsUI(db: Db): Promise<BalanceReading[]> {
  void db;
  return api<BalanceReading[]>("/account-balance-readings");
}

// --- SimpleFIN connector -----------------------------------------------------
// Mirrors server/services/connectorService.ts. The setup token itself never
// passes through here: it is read server-side from a file on disk, because it
// decodes to credentials for every linked bank.

export interface ConnectorStatus {
  connected: boolean;
  lastSyncedAt: string | null;
  earliestBackfilled: string | null;
  lastErrors: { code: string; message: string; accountId: string | null; connectionId: string | null; connectionName?: string | null }[];
  accountsNeedingType: (Account & { suggestedType: string | null })[];
  setupTokenPath: string;
  /** SimpleFIN access itself is gone (not one bank needing a sign-in): only a new setup token helps. */
  accessLost: boolean;
  /** A sync is running right now (usually the start-up one); older servers leave it out. */
  syncing?: boolean;
}

export interface SyncSummary {
  inserted: number;
  updated: number;
  accounts: number;
  holdings: number;
  errors: { code: string; message: string; accountId: string | null; connectionId: string | null }[];
  needsReconnect: boolean;
  /** Bank connections that need a fresh sign-in on the Bridge; the rest still imported. */
  signInNeeded?: string[];
  skipped: number;
}

// --- Mortgage rates -------------------

export interface WeeklyRate { ratePct: number; weekOf: string }
export interface MortgageRates { thirtyYear: WeeklyRate; fifteenYear: WeeklyRate }

/** Freddie Mac's weekly averages, or null when they cannot be had (the helper then leaves the rate for the user to type). */
export async function getMortgageRatesUI(db: Db): Promise<MortgageRates | null> {
  void db;
  return api<MortgageRates>("/mortgage-rates").catch(() => null);
}

/** Which app answered: the sample (made-up data in its own folder) or a real one. A server without the route is a real one. */
export async function getInstanceUI(): Promise<{ sample: boolean }> {
  return apiOr404<{ sample: boolean }>("/instance", { sample: false });
}

export async function getConnectorStatusUI(db: Db): Promise<ConnectorStatus> {
  void db;
  return api<ConnectorStatus>("/simplefin/status");
}

export async function connectSimpleFinUI(db: Db): Promise<{ connected: boolean; alreadyConnected: boolean }> {
  void db;
  return api<{ connected: boolean; alreadyConnected: boolean }>("/simplefin/connect", { method: "POST" });
}

/** Swap a dead access for a fresh setup token read from the usual file; data and sync dates are kept. */
export async function reconnectSimpleFinUI(db: Db): Promise<{ reconnected: true }> {
  void db;
  // The server's refusals are plain words ("No setup token found ..."), so show them as they are.
  await postShowingRefusal("/simplefin/reconnect", {});
  return { reconnected: true };
}

export async function disconnectSimpleFinUI(db: Db): Promise<void> {
  void db;
  await postShowingRefusal("/simplefin/disconnect", { confirmed: true });
}

export async function syncSimpleFinUI(db: Db): Promise<SyncSummary> {
  void db;
  const res = await api<{ ok: boolean; summary: SyncSummary }>("/simplefin/sync", { method: "POST" });
  return res.summary;
}

export async function setAccountTypeUI(db: Db, id: string, type: string): Promise<void> {
  void db;
  await api<void>(`/accounts/${encodeURIComponent(id)}/type`, { method: "POST", body: JSON.stringify({ type }) });
}

export async function setAccountDrawableUI(db: Db, id: string, drawable: boolean | null): Promise<void> {
  void db;
  await api<void>(`/accounts/${encodeURIComponent(id)}/drawable`, { method: "POST", body: JSON.stringify({ drawable }) });
}

/** The pot account: the one account the charity pot is set aside in. */
export async function setAccountMaaserPotUI(db: Db, id: string, on: boolean): Promise<void> {
  void db;
  await api<void>(`/accounts/${encodeURIComponent(id)}/maaser-pot`, { method: "POST", body: JSON.stringify({ on }) });
}

export async function getRulesUI(db: Db): Promise<CategorizationRule[]> {
  void db;
  return api<CategorizationRule[]>("/rules");
}

export async function addRuleUI(db: Db, rule: Omit<CategorizationRule, "id">): Promise<number> {
  void db;
  const res = await api<{ id: number }>("/rules", { method: "POST", body: JSON.stringify(rule) });
  return res.id;
}

export async function deleteRuleUI(db: Db, id: number): Promise<void> {
  void db;
  await api<void>(`/rules/${id}`, { method: "DELETE" });
}

export async function bootstrapRulesUI(db: Db): Promise<{ created: number }> {
  void db;
  return api<{ created: number }>("/rules/bootstrap", { method: "POST" });
}

/**
 * The planning categories a transaction can be filed under.
 *
 * Derived from the category-mapping table rather than a hardcoded list, so the
 * review queue always offers exactly the taxonomy the budget actually uses.
 */
/**
 * Record a category the user typed that no mapping knows yet. An
 * identity mapping (the name maps to itself) is how a category exists in this
 * app: getCategoriesUI reads mapping values, so the name shows in every picker
 * from then on, and it can be renamed or merged under Settings, Mappings.
 */
export async function createCategoryUI(db: Db, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A category needs a name.");
  // The name may already be an INCOMING category folded into some other budget
  // line. An identity mapping would overwrite that fold and quietly re-file every
  // past transaction from the feed's category. Refuse, and say where to change it.
  // Ignoring case and spaces on both sides, the way the picker decides whether a
  // name is new; the database keeps "coffee shops" and "Coffee Shops" apart.
  const key = trimmed.toLowerCase();
  const mappings = await getCategoryMappingsUI(db);
  const hit = Object.entries(mappings).find(([source]) => source.trim().toLowerCase() === key);
  if (hit) {
    const [source, planning] = hit;
    if (planning.trim().toLowerCase() !== key) {
      throw new Error(
        `"${source}" is already a category from the bank feed, filed under ${planning}. ` +
          "To use that name on its own, change its mapping under Settings, Mappings."
      );
    }
    return; // already exists
  }
  await setCategoryMappingUI(db, trimmed, trimmed);
}

export async function getCategoriesUI(db: Db): Promise<string[]> {
  const mappings = await getCategoryMappingsUI(db);
  return [...new Set(Object.values(mappings))].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/**
 * Rebuilds every learned rule from history. Unlike bootstrap (which only
 * adds), this retires rules the current derivation logic would no longer
 * produce. Hand-written rules survive.
 */
export async function rederiveRulesUI(db: Db): Promise<{ removed: number; created: number }> {
  void db;
  return api<{ removed: number; created: number }>("/rules/rederive", { method: "POST" });
}

export async function getUncategorizedUI(db: Db): Promise<NormalizedTxn[]> {
  void db;
  return api<NormalizedTxn[]>("/transactions/uncategorized");
}

// App-owned data-quality adjustments: mirrors repo.node.ts's
// getTransactionAdjustments/addTransactionAdjustment. Consumers apply these
// via src/domain/adjustments.ts's applyAdjustments(txns, adj) before
// rollupMonthly -- never by mutating synced transaction rows, so a Monarch
// re-sync never reverts them.
export async function getTransactionAdjustmentsUI(db: Db): Promise<TransactionAdjustment[]> {
  void db;
  return api<TransactionAdjustment[]>("/transaction-adjustments");
}

// Scenarios: mirrors repo.node.ts's listScenarios/getScenario/upsertScenario/
// deleteScenario. A what-if is one of these rows too (told apart by whether
// it has a what_if_settings row); an older scenario row is a leftover kept
// only until it is retired. "Set default" and the lifestyle-view line
// overrides left with the Scenarios and Lifestyle screens -- no screen calls them, so there is no client function for
// either here any more.
export async function listScenariosUI(db: Db, planId: string): Promise<Scenario[]> {
  void db;
  return api<Scenario[]>(`/plans/${encodeURIComponent(planId)}/scenarios`);
}

export async function upsertScenarioUI(db: Db, s: Scenario): Promise<void> {
  void db;
  await api<void>("/scenarios", { method: "POST", body: JSON.stringify(s) });
}

export async function deleteScenarioUI(db: Db, id: string): Promise<void> {
  void db;
  await api<void>(`/scenarios/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// What-ifs. Mirrors repo.node.ts's listWhatIfs/getWhatIf/saveWhatIf.
export async function listWhatIfsUI(db: Db, planId: string): Promise<WhatIf[]> {
  void db;
  return api<WhatIf[]>(`/plans/${encodeURIComponent(planId)}/what-ifs`);
}

/**
 * One step: the New button's scenario row and its empty
 * what-if, written together so a failure between two requests can never
 * leave an empty scenarios row no screen shows. A refusal carries the
 * server's plain-words reason.
 */
export async function createWhatIfUI(db: Db, planId: string, id: string, name: string): Promise<WhatIf> {
  void db;
  const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/what-ifs`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, name }),
  });
  if (res.ok) return (await res.json()) as WhatIf;
  let reason = `Could not create (${res.status}).`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) reason = body.error;
  } catch {
    // Not JSON: keep the status line.
  }
  throw new Error(reason);
}

/** A refusal carries the server's plain-words reason, so the screen can show it. */
export async function saveWhatIfUI(db: Db, w: WhatIf): Promise<void> {
  void db;
  const res = await fetch(`/api/scenarios/${encodeURIComponent(w.scenarioId)}/what-if`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(w),
  });
  if (res.ok) return;
  let reason = `Could not save (${res.status}).`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) reason = body.error;
  } catch {
    // Not JSON: keep the status line.
  }
  throw new Error(reason);
}

export async function getSalarySettingsUI(db: Db): Promise<SalaryAssumptions> {
  void db;
  const salary = await api<SalaryAssumptions>("/settings/salary");
  // The help and the screens that name the charity pot read its name and switch from here.
  rememberPotForHelp(salary.pot);
  return salary;
}

/** The user's current salary and the additional salary; read back with getSalarySettingsUI. */
export async function setIncomeSettingsUI(db: Db, income: IncomeSettings): Promise<void> {
  void db;
  await api<void>("/settings/income", { method: "POST", body: JSON.stringify(income) });
}

// BUDGET_LOG state migration: mirrors repo.node.ts's
// listBudgetNotes/listSnapshotHistory/listDataQualityFlags and
// the notes screen's read-only lists.
export async function listBudgetNotesUI(db: Db, planId: string): Promise<BudgetNote[]> {
  void db;
  return api<BudgetNote[]>(`/plans/${encodeURIComponent(planId)}/budget-notes`);
}

export async function listSnapshotHistoryUI(db: Db, planId: string): Promise<SnapshotHistoryEntry[]> {
  void db;
  return api<SnapshotHistoryEntry[]>(`/plans/${encodeURIComponent(planId)}/snapshots`);
}

export async function listDataQualityFlagsUI(db: Db, planId: string): Promise<DataQualityFlag[]> {
  void db;
  return api<DataQualityFlag[]>(`/plans/${encodeURIComponent(planId)}/data-quality-flags`);
}

// Category settings: mirrors repo.node.ts's getCategorySettings/
// upsertCategorySetting/setCategoryPinned/setCategoryRecurring. Recurring vs
// non-recurring (fixed bill vs variable spend) and pinned (user hand-set the
// default amount; the seed must never overwrite it) are per-category flags
// that live alongside budget lines, not inside them.
export async function getCategorySettingsUI(db: Db): Promise<CategorySetting[]> {
  void db;
  return api<CategorySetting[]>("/category-settings");
}

export async function setCategoryRecurringUI(
  db: Db,
  planningCategory: string,
  recurring: boolean | null
): Promise<void> {
  void db;
  await api<void>(`/category-settings/${encodeURIComponent(planningCategory)}/recurring`, {
    method: "POST",
    body: JSON.stringify({ recurring }),
  });
}

// The user's recurring choices: Not recurring, Mark as recurring,
// Show again. The read tolerates the route not existing yet, like the other new reads.
export async function getRecurringChoicesUI(db: Db): Promise<RecurringChoice[]> {
  void db;
  return apiOr404<RecurringChoice[]>("/recurring-choices", []);
}

/** Save one choice. A refusal throws the server's plain words, which the screen shows as they are. */
export async function saveRecurringChoiceUI(db: Db, choice: RecurringChoiceInput): Promise<void> {
  void db;
  const res = await fetch("/api/recurring-choices", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(choice),
  });
  if (res.ok) return;
  let reason = `Could not save the choice (${res.status}).`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) reason = body.error;
  } catch {
    // Not JSON: keep the status line.
  }
  throw new Error(reason);
}

/** Show again: the choice is deleted, so the app decides on its own once more. */
export async function deleteRecurringChoiceUI(db: Db, payeeKey: string, accountId: string, amountCents: number | null = null): Promise<void> {
  void db;
  const params = new URLSearchParams({ payeeKey, accountId });
  if (amountCents !== null) params.set("amountCents", String(amountCents));
  await api<void>(`/recurring-choices?${params}`, { method: "DELETE" });
}

// Notes, filing and Undo. A refused write throws the
// server's own words, so the screen shows them rather than a status number.
async function writeWithWords<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let reason = `${fallback} (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) reason = body.error;
    } catch {
      // No words from the server: the fallback stands.
    }
    throw new Error(reason);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export async function getTransactionNotesUI(db: Db): Promise<TransactionNote[]> {
  void db;
  return apiOr404<TransactionNote[]>("/transaction-notes", []);
}

/** An empty note deletes it. */
export async function saveTransactionNoteUI(db: Db, id: string, note: string): Promise<void> {
  void db;
  await writeWithWords<void>(`/transaction-notes/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ note }) }, "Could not save the note");
}

export async function getMaaserMarksUI(db: Db): Promise<MaaserMark[]> {
  void db;
  return apiOr404<MaaserMark[]>("/maaser-marks", []);
}

/** Saves or replaces the mark on one transaction. */
export async function saveMaaserMarkUI(db: Db, mark: MaaserMarkInput): Promise<void> {
  void db;
  const { sourceTransactionId, ...rest } = mark;
  await writeWithWords<void>(`/maaser-marks/${encodeURIComponent(sourceTransactionId)}`, { method: "PUT", body: JSON.stringify(rest) }, "Could not save the mark");
}

export async function deleteMaaserMarkUI(db: Db, id: string): Promise<void> {
  void db;
  await writeWithWords<void>(`/maaser-marks/${encodeURIComponent(id)}`, { method: "DELETE" }, "Could not remove the mark");
}

/** One filing: the rule or one-row change, the note and the recurring mark, written together. */
export async function fileCategorizationUI(db: Db, filing: FilingInput): Promise<{ id: number }> {
  void db;
  return writeWithWords<{ id: number }>("/categorizations", { method: "POST", body: JSON.stringify(filing) }, "Could not file it");
}

export async function undoCategorizationUI(db: Db, id: number): Promise<{ undone: boolean }> {
  void db;
  return writeWithWords<{ undone: boolean }>(`/categorizations/${id}/undo`, { method: "POST" }, "Could not undo it");
}

/** The last 30 days of filings, newest first. */
export async function getRecentCategorizationsUI(db: Db): Promise<CategorizationLogEntry[]> {
  void db;
  return apiOr404<CategorizationLogEntry[]>("/categorizations", []);
}

// Merchants: the rename list and the dismissed
// suggestions. The reads tolerate the routes not existing yet (the screens ship
// ahead of a server restart): no renames and no dismissals is the app as before.
export async function getMerchantRenamesUI(db: Db): Promise<MerchantRename[]> {
  void db;
  return apiOr404<MerchantRename[]>("/merchant-renames", []);
}

/** A PUT whose refusal throws the server's plain words, which the screen shows as they are. */
async function putOrExplain(path: string, body: unknown, what: string): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return;
  let reason = `Could not save ${what} (${res.status}).`;
  try {
    const parsed = (await res.json()) as { error?: string };
    if (parsed.error) reason = parsed.error;
  } catch {
    // Not JSON: keep the status line.
  }
  throw new Error(reason);
}

export async function saveMerchantRenameUI(db: Db, rename: MerchantRenameInput): Promise<void> {
  void db;
  await putOrExplain("/merchant-renames", rename, "the rename");
}

export async function deleteMerchantRenameUI(db: Db, sourceName: string): Promise<void> {
  void db;
  await api<void>(`/merchant-renames?${new URLSearchParams({ sourceName })}`, { method: "DELETE" });
}

export async function getSuggestionDismissalsUI(db: Db): Promise<SuggestionDismissal[]> {
  void db;
  return apiOr404<SuggestionDismissal[]>("/merchant-suggestion-dismissals", []);
}

export async function dismissSuggestionUI(
  db: Db,
  dismissal: { kind: SuggestionDismissal["kind"]; fromName: string; intoName: string }
): Promise<void> {
  void db;
  await putOrExplain("/merchant-suggestion-dismissals", dismissal, "the dismissal");
}

export async function showSuggestionAgainUI(db: Db, id: string): Promise<void> {
  void db;
  await api<void>(`/merchant-suggestion-dismissals?${new URLSearchParams({ id })}`, { method: "DELETE" });
}

// The theme switch (Settings, Appearance). Absent or unknown reads "system".
export type ThemePreference = "light" | "dark" | "system";

export async function getThemeUI(db: Db): Promise<ThemePreference> {
  void db;
  const { theme } = await apiOr404<{ theme?: string }>("/settings/theme", { theme: "system" });
  return theme === "light" || theme === "dark" ? theme : "system";
}

export async function setThemeUI(db: Db, theme: ThemePreference): Promise<void> {
  void db;
  await api<void>("/settings/theme", { method: "POST", body: JSON.stringify({ theme }) });
}
