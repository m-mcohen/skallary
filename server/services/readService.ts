// server/services/readService.ts
//
// Business-logic layer, sitting between api/routes and the repository
// seam. Every function here is a thin pass-through to the repository --
// no SQL, no reshaping. The repo (NodeRepository, via the FinanceRepository
// seam) already does the domain<->column mapping (camelCase<->snake_case,
// integer cents, the ''<->null budget-line period boundary), so these just
// forward args/return values so the JSON the routes send is exactly the
// shape the UI's `*UI` functions (src/ui/lib/db.ts) expect.
import type { FinanceRepository } from "../repositories/financeRepository.js";
import { sqliteFinanceRepository } from "../repositories/sqliteFinanceRepository.js";
import * as mappingBootstrapService from "./mappingBootstrapService.js";
import * as seedBudgetService from "./seedBudgetService.js";
import { expandedBudgetLines } from "./budgetChangeService.js";
import { withEffectiveInclude } from "../../src/domain/account-filter.js";
import { isOwnerSlot } from "../../src/domain/household.js";
import { applyRules } from "../../src/domain/rules.js";
import { matchTransfers } from "../../src/domain/transfers.js";
import { getHousehold, setHousehold, getIncludePartnerAccounts, setIncludePartnerAccounts, getSeedStatus, setLastSeedAt, getShowGuideLines, setShowGuideLines, getZelleMemoNames, setZelleMemoNames, getMaaserFloorCents, setMaaserFloorCents, withPotAccount } from "./settingsService.js";
import * as trailingService from "./trailingService.js";
import type { NormalizedTxn, Account } from "../../src/domain/types.js";
import type { Plan, BudgetLine, Goal, GoalAccountLink, WishlistItem, AccountBalance, BalanceReading } from "../../src/domain/plan-types.js";
import { goalLinkConflict, isGoalType } from "../../src/domain/goals.js";
import { costLinesToWrite, type StartCostRequest } from "../../src/domain/goal-cost.js";
import { localDateIso } from "../../src/domain/period.js";
import type { TransactionAdjustment } from "../../src/domain/adjustments.js";
import type { Scenario } from "../../src/domain/scenario.js";
import { whatIfProblem, type WhatIf } from "../../src/domain/what-if.js";
import type { BudgetNote, SnapshotHistoryEntry, DataQualityFlag } from "../../src/domain/notes-types.js";
import type { CategorySetting } from "../../src/domain/category-settings.js";
import { validateChoice, type RecurringChoice } from "../../src/domain/recurring-choices.js";
import { cleanNote, type TransactionNote } from "../../src/domain/categorizations.js";
import { cleanMaaserMark, type MaaserMark } from "../../src/domain/maaser-marks.js";
import { validateDismissal, validateRename, type MerchantRename, type SuggestionDismissal } from "../../src/domain/merchants.js";

/** Thrown when a route targets an id that doesn't exist; routes map this to 404. */
export class NotFound extends Error {}
/** Thrown when a write collides with a row another record already claims; routes map this to 409. */
export class Conflict extends Error {}

export function getAccountCount(repo: FinanceRepository): number {
  return repo.getAccounts().length;
}

// Re-exported for convenience/backward-callers of readService; the actual
// implementation lives in settingsService.ts (see that file's header for
// why it's split out -- avoids an import cycle with seedBudgetService).
export { getHousehold, setHousehold, getIncludePartnerAccounts, setIncludePartnerAccounts };

// GET/POST /api/settings/guide -- same split, same reason (the guide line's switch).
export { getShowGuideLines, setShowGuideLines };

// GET/POST /api/settings/zelle-names: off until the user turns it on.
export { getZelleMemoNames, setZelleMemoNames };

// GET/POST /api/settings/maaser-floor: the floor kept in the pot account.
export { getMaaserFloorCents, setMaaserFloorCents };

// GET/POST /api/settings/seed -- same split, same reason.
export { getSeedStatus, setLastSeedAt };

// GET /api/trailing?months=N: average monthly expense over the N complete
// months before the current one, prepared like the seed. Actuals are shared
// across plans, so the route is not plan-scoped.
export function trailingSpend(months: number | undefined): trailingService.TrailingSpend {
  return trailingService.trailingSpend(months);
}

// GET /api/accounts: the CALC-FACING account list. Returns accounts with
// includeInSpend rewritten to the EFFECTIVE value (owner slot + the
// include-partner setting), so every consumer of getAccountsUI (RunwayOverview,
// BudgetGrid, Charts, Overview) honors the owner/toggle exclusion lever
// with zero client changes -- they already branch on includeInSpend.
export function getAccounts(): Account[] {
  const repo = sqliteFinanceRepository();
  // With the charity pot off, no account is the pot account.
  return withPotAccount(withEffectiveInclude(repo.getAccounts(), getIncludePartnerAccounts()));
}

// GET /api/accounts/manage: the RAW account list (owner + the raw,
// un-rewritten includeInSpend) for the Accounts management UI -- callers
// here need to see/set the actual per-account state, not the derived
// calc-facing value getAccounts() returns.
export function getAccountsManage(): Account[] {
  return sqliteFinanceRepository().getAccounts();
}

// POST /api/accounts/:id/owner: one of the three owner slots.
export function setAccountOwner(id: string, owner: unknown): void {
  if (!isOwnerSlot(owner)) throw new Error("An account belongs to you, your partner, or both of you.");
  sqliteFinanceRepository().setAccountOwner(id, owner);
}

// POST /api/accounts/:id/include
export function setAccountInclude(id: string, includeInSpend: boolean): void {
  sqliteFinanceRepository().setAccountIncludeInSpend(id, includeInSpend);
}

// A setting by key, as stored.
export function getSetting(key: string): string | null {
  return sqliteFinanceRepository().getSetting(key);
}

// Stores a setting by key.
export function setSetting(key: string, value: string): void {
  sqliteFinanceRepository().setSetting(key, value);
}

// GET /api/transactions
// GET /api/transactions: rows with the app-owned categorization ALREADY
// applied -- rules first (SimpleFIN rows arrive with no category at all), then
// transfer pair-matching. Adjustments deliberately stay client-side, where
// they already run, so the full order across the wire is still
// rules -> transfers -> adjustments (see src/domain/pipeline.ts).
//
// Doing this here rather than in each UI consumer means every screen gets the
// same categorization without four call sites drifting apart.
export function getTransactions(): NormalizedTxn[] {
  const repo = sqliteFinanceRepository();
  return matchTransfers(applyRules(repo.getTransactions(), repo.getCategorizationRules()));
}

// GET /api/category-mappings
export function getCategoryMappings(): Record<string, string> {
  return sqliteFinanceRepository().getCategoryMappings();
}

// POST /api/category-mappings
export function setCategoryMapping(sourceCategory: string, planningCategory: string): void {
  sqliteFinanceRepository().setCategoryMapping(sourceCategory, planningCategory);
}

// GET /api/plans/:id
export function getPlan(id: string): Plan | null {
  return sqliteFinanceRepository().getPlan(id);
}

// GET /api/plans
export function listPlans(): Plan[] {
  return sqliteFinanceRepository().listPlans();
}

// POST /api/plans
export function createPlan(p: Omit<Plan, "createdAt">): Plan {
  return sqliteFinanceRepository().createPlan(p);
}

// GET /api/plans/:planId/budget-lines: the user's changes arrive as one-month rows (origin "change").
export function getBudgetLines(planId: string): BudgetLine[] {
  return expandedBudgetLines(planId);
}

// POST /api/budget-lines: an every-month amount typed by the user is the user's (migration 0032).
export function setBudgetLine(line: BudgetLine): void {
  sqliteFinanceRepository().setBudgetLine(line.period === null ? { ...line, source: "you" } : line);
}

// DELETE /api/budget-lines: reverts a per-month override to the category's
// default (period: null) when called with a period, or clears the default
// line itself when called without one.
export function deleteBudgetLine(planId: string, planningCategory: string, period: string | null): void {
  sqliteFinanceRepository().deleteBudgetLine(planId, planningCategory, period);
}

// GET /api/goals
export function listGoals(): Goal[] {
  return sqliteFinanceRepository().listGoals();
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a goal payload and fills the fields 0018 added, so the six-field
 * shape from before it (older scripts, tests/server/security.test.ts) still
 * writes a valid row. Every message is plain language: the dialog shows it.
 */
export function normalizeGoal(input: unknown): Goal {
  const raw = (input ?? {}) as Record<string, unknown>;
  if (typeof raw !== "object") throw new Error("A goal is required.");
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) throw new Error("Goal id is required.");
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) throw new Error("Name is required.");
  const goalType = raw.goalType ?? "savings";
  if (!isGoalType(goalType)) throw new Error("Unknown goal type.");
  const targetAmountCents = raw.targetAmountCents;
  if (!Number.isInteger(targetAmountCents) || (targetAmountCents as number) <= 0) {
    throw new Error("Target amount must be greater than zero.");
  }
  const targetDate = raw.targetDate ?? null;
  if (targetDate !== null && !(typeof targetDate === "string" && ISO_DATE.test(targetDate))) {
    throw new Error("Target date must be a date (YYYY-MM-DD) or blank.");
  }
  const priority = raw.priority ?? 0;
  if (!Number.isInteger(priority)) throw new Error("Priority must be a whole number.");
  const currentAmountCents = raw.currentAmountCents ?? 0;
  if (!Number.isInteger(currentAmountCents) || (currentAmountCents as number) < 0) {
    throw new Error("Saved outside linked accounts cannot be negative.");
  }
  const plannedMonthlyCents = raw.plannedMonthlyCents ?? 0;
  if (!Number.isInteger(plannedMonthlyCents) || (plannedMonthlyCents as number) < 0) {
    throw new Error("Planned monthly contribution cannot be negative.");
  }
  const notes = raw.notes ?? "";
  if (typeof notes !== "string") throw new Error("Notes must be text.");
  const archivedAt = raw.archivedAt ?? null;
  if (archivedAt !== null && typeof archivedAt !== "string") throw new Error("Archived timestamp must be text or blank.");
  // 0022: what the goal costs once reached, and its marks.
  // Absent stays absent (undefined), so a save that leaves these out keeps
  // what is stored; null clears.
  const ongoingMonthlyCents = raw.ongoingMonthlyCents;
  if (ongoingMonthlyCents !== undefined && (!Number.isInteger(ongoingMonthlyCents) || (ongoingMonthlyCents as number) < 0)) {
    throw new Error("Ongoing cost a month cannot be negative.");
  }
  const ongoingStartedPeriod = raw.ongoingStartedPeriod;
  if (ongoingStartedPeriod !== undefined && ongoingStartedPeriod !== null && !(typeof ongoingStartedPeriod === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(ongoingStartedPeriod))) {
    throw new Error("The month a cost started must be a month (YYYY-MM) or blank.");
  }
  const ongoingBudgetLine = raw.ongoingBudgetLine;
  if (ongoingBudgetLine !== undefined && ongoingBudgetLine !== null && typeof ongoingBudgetLine !== "string") throw new Error("The budget line must be text or blank.");
  const completedAt = raw.completedAt;
  if (completedAt !== undefined && completedAt !== null && typeof completedAt !== "string") throw new Error("Completed timestamp must be text or blank.");
  return {
    id,
    name,
    goalType,
    targetAmountCents: targetAmountCents as number,
    targetDate: targetDate as string | null,
    priority: priority as number,
    currentAmountCents: currentAmountCents as number,
    plannedMonthlyCents: plannedMonthlyCents as number,
    notes,
    archivedAt: archivedAt as string | null,
    ongoingMonthlyCents: ongoingMonthlyCents as number | undefined,
    ongoingStartedPeriod: ongoingStartedPeriod as string | null | undefined,
    ongoingBudgetLine: ongoingBudgetLine as string | null | undefined,
    completedAt: completedAt as string | null | undefined,
  };
}

// POST /api/goals/:id/state -- Mark complete / unmark, and starting a goal's
// cost. The goal update and every budget entry go
// in one transaction: a refusal writes nothing, not even the completed mark.
export function setGoalState(goalId: string, input: unknown, now: Date = new Date()): void {
  const body = (input ?? {}) as { completed?: unknown; startCost?: StartCostRequest };
  const repo = sqliteFinanceRepository();
  const goal = repo.listGoals().find((g) => g.id === goalId);
  if (!goal) throw new NotFound("Goal not found.");
  const next: Goal = { ...goal };
  if (body.completed !== undefined) {
    if (typeof body.completed !== "boolean") throw new Error("Completed must be yes or no.");
    next.completedAt = body.completed ? now.toISOString() : null;
  }
  let write: BudgetLine[] = [];
  let goalChange: { planId: string; line: string; fromMonth: string; deltaCents: number } | undefined;
  if (body.startCost) {
    if (!goal.ongoingMonthlyCents) throw new Error("This goal has no ongoing cost to start.");
    if (goal.ongoingStartedPeriod) throw new Error("This goal's cost is already in your budget.");
    const plan = repo.getPlan(String(body.startCost.planId ?? ""));
    if (!plan) throw new Error("That budget plan does not exist.");
    // The month of the click in local time, the month the dialog showed the user
    // (the server runs on the user's laptop). UTC would say October on a September
    // evening.
    const startPeriod = localDateIso(now).slice(0, 7);
    const line = String(body.startCost.line ?? "");
    const r = costLinesToWrite({
      lines: repo.getBudgetLines(plan.id), planId: plan.id, planStartDate: plan.startDate, planEndDate: plan.endDate,
      line, mode: body.startCost.mode === "existing" ? "existing" : "new",
      monthlyCents: goal.ongoingMonthlyCents, startPeriod,
    });
    if ("error" in r) throw new Error(r.error);
    write = r.write;
    goalChange = { planId: plan.id, ...r.goalChange };
    next.ongoingStartedPeriod = startPeriod;
    next.ongoingBudgetLine = r.line;
  }
  repo.applyGoalChange(next, write, goalChange);
}

// POST /api/goals
export function upsertGoal(input: unknown): void {
  const goal = normalizeGoal(input);
  const repo = sqliteFinanceRepository();
  // Once a cost is in the budget, the Budget screen owns it. The same amount, or leaving the field out, still saves.
  const stored = repo.listGoals().find((g) => g.id === goal.id);
  if (stored?.ongoingStartedPeriod && goal.ongoingMonthlyCents !== undefined && goal.ongoingMonthlyCents !== stored.ongoingMonthlyCents) {
    throw new Error("This cost is already in your budget. Change it on the Budget screen.");
  }
  repo.upsertGoal(goal);
  // Archiving releases the goal's claim on its accounts (Monarch does the
  // same: archiving withdraws the funds and keeps the goal). An archived goal
  // used to keep its links, so an entire-balance link still blocked
  // every other goal from that account and still zeroed Available for goals.
  if (goal.archivedAt) repo.replaceGoalAccountLinks(goal.id, []);
}

// DELETE /api/goals/:id
export function deleteGoal(id: string): void {
  sqliteFinanceRepository().deleteGoal(id);
}

// GET /api/goal-links
export function listGoalAccountLinks(): GoalAccountLink[] {
  return sqliteFinanceRepository().listGoalAccountLinks();
}

// PUT /api/goals/:id/links -- replace-all. Validation is here, not in the
// route (routes stay thin); the one-entire-balance-goal-per-account rule is
// the database's partial UNIQUE index, surfaced as a Conflict (409).
export function replaceGoalAccountLinks(goalId: string, input: unknown): void {
  const repo = sqliteFinanceRepository();
  if (!repo.listGoals().some((g) => g.id === goalId)) throw new NotFound("No such goal.");
  if (!Array.isArray(input)) throw new Error("Links must be a list.");
  const accountIds = new Set(repo.getAccounts().map((a) => a.id));
  const seen = new Set<string>();
  const links: GoalAccountLink[] = input.map((raw: any) => {
    if (!raw || typeof raw.accountId !== "string" || !accountIds.has(raw.accountId)) throw new Error("Unknown account.");
    if (raw.mode !== "entire" && raw.mode !== "fixed") throw new Error("Each link is either the entire balance or a fixed amount.");
    if (raw.mode === "fixed" && !(Number.isInteger(raw.amountCents) && raw.amountCents >= 0)) {
      throw new Error("A fixed amount must be zero or more.");
    }
    if (seen.has(raw.accountId)) throw new Error("An account can be linked to a goal only once.");
    seen.add(raw.accountId);
    return { goalId, accountId: raw.accountId, mode: raw.mode, amountCents: raw.mode === "fixed" ? raw.amountCents : null };
  });
  const conflict = goalLinkConflict(goalId, links, repo.listGoalAccountLinks());
  if (conflict) throw new Conflict(conflict);
  try {
    repo.replaceGoalAccountLinks(goalId, links);
  } catch (e: any) {
    if (typeof e?.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT") && /UNIQUE/.test(String(e.message))) {
      throw new Conflict("That account already funds another goal with its entire balance.");
    }
    throw e;
  }
}

// GET /api/wishlist
export function listWishlistItems(): WishlistItem[] {
  return sqliteFinanceRepository().listWishlistItems();
}

// POST /api/wishlist
export function upsertWishlistItem(w: WishlistItem): void {
  sqliteFinanceRepository().upsertWishlistItem(w);
}

// DELETE /api/wishlist/:id
// PUT /api/wishlist/order -- the whole order, top first. It must
// name every item exactly once, or the screen was stale: refuse, change nothing.
export function reorderWishlist(ids: unknown): void {
  const repo = sqliteFinanceRepository();
  const stored = new Set(repo.listWishlistItems().map((w) => w.id));
  const ok =
    Array.isArray(ids) &&
    ids.every((id) => typeof id === "string" && stored.has(id)) &&
    new Set(ids).size === ids.length &&
    ids.length === stored.size;
  if (!ok) throw new Error("The Wish List changed since this screen loaded. Reload and try again.");
  repo.reorderWishlist(ids as string[]);
}

export function deleteWishlistItem(id: string): void {
  sqliteFinanceRepository().deleteWishlistItem(id);
}

// POST /api/bootstrap-mappings: append-only -- fills identity mappings for
// distinct source categories that have no mapping yet, never overwrites an
// existing (possibly user-customized) one.
export function bootstrapMappings(): { added: number; total: number } {
  return mappingBootstrapService.run();
}

// POST /api/plans/:id/seed-budget: seeds expense-category budget defaults
// (period: null) from trailing actuals (adjustments applied, income never
// auto-seeded); per-month overrides are never touched.
export function seedBudget(
  planId: string,
  windowMonths: number
): { window: string[]; seededCategories: number; skippedPinned: string[] } {
  return seedBudgetService.run(planId, windowMonths);
}

// GET /api/account-balances
export function getAccountBalances(): AccountBalance[] {
  return sqliteFinanceRepository().getAccountBalances();
}

// POST /api/account-balances
// GET /api/account-balance-readings: one reading per account per day,
// the history behind Accounts, Net worth.
export function listBalanceReadings(): BalanceReading[] {
  return sqliteFinanceRepository().listBalanceReadings();
}

export function upsertAccountBalances(rows: AccountBalance[]): void {
  sqliteFinanceRepository().upsertAccountBalances(rows);
}

// GET /api/transaction-adjustments
export function getTransactionAdjustments(): TransactionAdjustment[] {
  return sqliteFinanceRepository().getTransactionAdjustments();
}

// POST /api/transaction-adjustments
export function addTransactionAdjustment(a: TransactionAdjustment): void {
  sqliteFinanceRepository().addTransactionAdjustment(a);
}

// DELETE /api/transaction-adjustments/:id: a one-row change, by its id.
export function deleteTransactionAdjustment(id: number): void {
  if (Number.isInteger(id)) sqliteFinanceRepository().deleteTransactionAdjustment(id);
}

// GET /api/transaction-notes. The sync never writes this table.
export function listTransactionNotes(): TransactionNote[] {
  return sqliteFinanceRepository().listTransactionNotes();
}

// PUT /api/transaction-notes/:id. An empty note deletes it.
export function saveTransactionNote(id: unknown, raw: unknown, now: () => Date = () => new Date()): void {
  if (typeof id !== "string" || id.trim() === "") throw new Error("Unknown transaction.");
  const checked = cleanNote(raw);
  if (typeof checked === "string") throw new Error(checked);
  sqliteFinanceRepository().setTransactionNote(id, checked.note, now().toISOString());
}

// GET /api/maaser-marks (migration 0035). The sync never writes this table.
export function listMaaserMarks(): MaaserMark[] {
  return sqliteFinanceRepository().listMaaserMarks();
}

// PUT /api/maaser-marks/:id. A part above the row's amount is refused when the row is known.
export function saveMaaserMark(id: unknown, raw: unknown, now: () => Date = () => new Date()): void {
  const checked = cleanMaaserMark(id, raw);
  if (typeof checked === "string") throw new Error(checked);
  const repo = sqliteFinanceRepository();
  if (checked.countedCents !== null) {
    const row = repo.getTransactions().find((t) => t.sourceTransactionId === checked.sourceTransactionId);
    if (row && checked.countedCents > Math.abs(row.amountCents)) throw new Error("The part that counts can be at most the row's amount.");
  }
  repo.setMaaserMark(checked, now().toISOString());
}

// DELETE /api/maaser-marks/:id: unmark.
export function deleteMaaserMark(id: unknown): void {
  if (typeof id !== "string" || id.trim() === "") throw new Error("Unknown transaction.");
  sqliteFinanceRepository().deleteMaaserMark(id.trim());
}

// GET /api/plans/:planId/scenarios
export function listScenarios(planId: string): Scenario[] {
  return sqliteFinanceRepository().listScenarios(planId);
}

// GET /api/scenarios/:id
export function getScenario(id: string): Scenario | null {
  return sqliteFinanceRepository().getScenario(id);
}

// POST /api/scenarios
export function upsertScenario(s: Scenario): void {
  sqliteFinanceRepository().upsertScenario(s);
}

// DELETE /api/scenarios/:id
export function deleteScenario(id: string): void {
  sqliteFinanceRepository().deleteScenario(id);
}

// GET /api/plans/:planId/what-ifs
export function listWhatIfs(planId: string): WhatIf[] {
  return sqliteFinanceRepository().listWhatIfs(planId);
}

// GET /api/scenarios/:id/what-if
export function getWhatIf(scenarioId: string): WhatIf {
  const w = sqliteFinanceRepository().getWhatIf(scenarioId);
  if (!w) throw new NotFound(`No what-if for ${scenarioId}.`);
  return w;
}

// POST /api/plans/:planId/what-ifs -- one step: the
// scenario row and its empty what-if, together in one transaction, so a
// failure between two requests can never leave an empty scenarios row no
// screen shows.
export function createWhatIf(planId: string, id: string, name: string): WhatIf {
  if (!id || typeof id !== "string") throw new Error("A what-if needs an id.");
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new Error("Give the what-if a name.");
  return sqliteFinanceRepository().createWhatIf(planId, id, trimmed, new Date().toISOString());
}

// PUT /api/scenarios/:id/what-if -- the whole what-if, replaced as a set.
export function saveWhatIf(scenarioId: string, w: WhatIf): void {
  const repo = sqliteFinanceRepository();
  if (!repo.getScenario(scenarioId)) throw new NotFound(`No scenario ${scenarioId}.`);
  if (!w || w.scenarioId !== scenarioId) throw new Error("This what-if belongs to a different scenario.");
  if (!Array.isArray(w.changes) || !Array.isArray(w.rows)) throw new Error("A what-if needs its list of changes and rows.");
  const problem = whatIfProblem(w);
  if (problem) throw new Error(problem);
  repo.saveWhatIf(w);
}

export { getSalarySettings, setSalarySettings, setIncomeSettings } from "./salarySettingsService.js";

// BUDGET_LOG state migration: notes/snapshots/flags are
// 100% app-authored (migrations/0007_budget_log_state.sql) -- thin
// pass-throughs, same convention as the rest of this file.

// GET /api/plans/:planId/budget-notes
export function listBudgetNotes(planId: string): BudgetNote[] {
  return sqliteFinanceRepository().listBudgetNotes(planId);
}

// GET /api/plans/:planId/snapshots
export function listSnapshotHistory(planId: string): SnapshotHistoryEntry[] {
  return sqliteFinanceRepository().listSnapshotHistory(planId);
}

// GET /api/plans/:planId/data-quality-flags
export function listDataQualityFlags(planId: string): DataQualityFlag[] {
  return sqliteFinanceRepository().listDataQualityFlags(planId);
}

// Category settings. Thin pass-throughs, same
// convention as the rest of this file.

// GET /api/category-settings
export function getCategorySettings(): CategorySetting[] {
  return sqliteFinanceRepository().getCategorySettings();
}

// POST /api/category-settings: full upsert of a category's settings.
export function upsertCategorySetting(s: CategorySetting): void {
  sqliteFinanceRepository().upsertCategorySetting(s);
}

// POST /api/category-settings/:category/pinned
export function setCategoryPinned(planningCategory: string, pinned: boolean): void {
  sqliteFinanceRepository().setCategoryPinned(planningCategory, pinned);
}

// POST /api/category-settings/:category/recurring
export function setCategoryRecurring(planningCategory: string, recurring: boolean | null): void {
  sqliteFinanceRepository().setCategoryRecurring(planningCategory, recurring);
}

// The user's recurring choices.

// GET /api/recurring-choices
export function listRecurringChoices(): RecurringChoice[] {
  return sqliteFinanceRepository().listRecurringChoices();
}

// PUT /api/recurring-choices: one choice; the server stamps the time, which
// decides which choice wins where two meet. A bad choice is refused in plain words.
export function saveRecurringChoice(input: unknown, now: () => Date = () => new Date()): void {
  const checked = validateChoice(input);
  if (typeof checked === "string") throw new Error(checked);
  sqliteFinanceRepository().upsertRecurringChoice({ ...checked, createdAt: now().toISOString() });
}

// DELETE /api/recurring-choices?payeeKey=&accountId=[&amountCents=] ("Show again"); the amount
// names which of a merchant's marks, none for the whole-merchant one.
export function deleteRecurringChoice(payeeKey: unknown, accountId: unknown, amountCents?: unknown): void {
  if (typeof payeeKey !== "string" || typeof accountId !== "string") throw new Error("Unknown choice.");
  let amount: number | null = null;
  if (amountCents !== undefined && amountCents !== null && amountCents !== "") {
    const n = Number(amountCents);
    if (!Number.isInteger(n) || n <= 0) throw new Error("The amount is whole dollars and cents, above zero.");
    amount = n;
  }
  sqliteFinanceRepository().deleteRecurringChoice(payeeKey, accountId, amount);
}

// Merchants.
// The rename list is read by the screens and applied at read time; no route here
// writes a transaction, a rule or a recurring choice.

// GET /api/merchant-renames
export function listMerchantRenames(): MerchantRename[] {
  return sqliteFinanceRepository().listMerchantRenames();
}

// PUT /api/merchant-renames: one rename; saving the same bank name again (any case) replaces it.
export function saveMerchantRename(input: unknown, now: () => Date = () => new Date()): void {
  const checked = validateRename(input);
  if (typeof checked === "string") throw new Error(checked);
  sqliteFinanceRepository().upsertMerchantRename({ ...checked, createdAt: now().toISOString() });
}

// DELETE /api/merchant-renames?sourceName= (the undo).
export function deleteMerchantRename(sourceName: unknown): void {
  if (typeof sourceName !== "string" || !sourceName.trim()) throw new Error("Pick the bank's name to rename.");
  sqliteFinanceRepository().deleteMerchantRename(sourceName);
}

// GET /api/merchant-suggestion-dismissals
export function listSuggestionDismissals(): SuggestionDismissal[] {
  return sqliteFinanceRepository().listSuggestionDismissals();
}

// PUT /api/merchant-suggestion-dismissals: the id is worked out here from the kind and the two names.
export function dismissSuggestion(input: unknown, now: () => Date = () => new Date()): void {
  const checked = validateDismissal(input);
  if (typeof checked === "string") throw new Error(checked);
  sqliteFinanceRepository().addSuggestionDismissal({ ...checked, createdAt: now().toISOString() });
}

// DELETE /api/merchant-suggestion-dismissals?id= ("Show again").
export function deleteSuggestionDismissal(id: unknown): void {
  if (typeof id !== "string" || !id) throw new Error("Unknown suggestion.");
  sqliteFinanceRepository().deleteSuggestionDismissal(id);
}
