// src/data/repo.ts
import type { NormalizedTxn, Account } from "../domain/types";
import type { Plan, BudgetLine, Goal, GoalAccountLink, WishlistItem, AccountBalance, BalanceReading, BudgetChange, BigMonth, MonthNote } from "../domain/plan-types";
import type { Scenario } from "../domain/scenario";
import type { WhatIf } from "../domain/what-if";
import type { BudgetNote, SnapshotHistoryEntry, DataQualityFlag } from "../domain/notes-types";
import type { CategorySetting } from "../domain/category-settings";
import type { RecurringChoice } from "../domain/recurring-choices";
import type { MerchantRename, SuggestionDismissal } from "../domain/merchants";
import type { CategorizationLogEntry, TransactionNote } from "../domain/categorizations";
import type { MaaserMark, MaaserMarkInput } from "../domain/maaser-marks";

export interface UpsertResult { inserted: number; updated: number; }

/** An investment position as stored -- money in cents, share count as the feed's string. */
export interface HoldingRow {
  accountId: string;
  symbol: string | null;
  description: string | null;
  shares: string | null;
  costBasisCents: number | null;
  marketValueCents: number | null;
  purchasePriceCents: number | null;
  currency: string | null;
}

/** Single-row connector state for the SimpleFIN Bridge. */
export interface SimpleFinState {
  /** Embeds Basic-Auth credentials -- the database file lives in the app's own data folder, never a synced one. */
  accessUrl: string | null;
  lastSyncedAt: string | null;
  /** Earliest date the 90-day backfill walker has reached, so it resumes. */
  earliestBackfilled: string | null;
  lastErrors: { code: string; message: string; accountId: string | null; connectionId: string | null; connectionName?: string | null }[];
}

export interface Repository {
  upsertAccounts(accounts: Account[]): void;
  upsertTransactions(txns: NormalizedTxn[]): UpsertResult;
  getTransactions(): NormalizedTxn[];
  /** Live (not retired) pending rows from one feed -- the pending->posted safeguard's input. */
  getPendingTransactions(source: string): NormalizedTxn[];
  getAccounts(): Account[];
  setAccountIncludeInSpend(id: string, include: boolean): void;
  setAccountOwner(id: string, owner: Account["owner"]): void;
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  getCategoryMappings(): Record<string, string>;
  setCategoryMapping(sourceCategory: string, planningCategory: string): void;
  lastSyncedDate(): string | null; // max txn date, 'YYYY-MM-DD' or null

  createPlan(p: Omit<Plan, "createdAt">): Plan;
  getPlan(id: string): Plan | null;
  listPlans(): Plan[];
  setBudgetLine(line: BudgetLine): void; // upsert on (plan_id, planning_category, period); atomically appends a change_log row
  getBudgetLines(planId: string): BudgetLine[];
  // Budget changes, big months and notes per line and month (migration 0032).
  listBudgetChanges(planId: string): BudgetChange[];
  changeLineFrom(planId: string, line: string, fromMonth: string, amountCents: number): BudgetChange[];
  setLineEveryMonth(planId: string, line: string, amountCents: number): BudgetChange[];
  resetLine(planId: string, line: string, suggestedCents: number): BudgetChange[];
  applySetup(planId: string, picks: { line: string; amountCents: number }[], stampIso: string): BudgetChange[];
  startPlanWithLines(plan: Omit<Plan, "createdAt">, lines: { line: string; amountCents: number; source: "you" | "suggested" }[], stampIso: string): Plan;
  addGoalChange(planId: string, line: string, fromMonth: string, deltaCents: number, goalId: string): void;
  listBigMonths(planId: string): BigMonth[];
  getBigMonth(id: number): BigMonth | null;
  addBigMonth(b: Omit<BigMonth, "id" | "createdAt">): BigMonth;
  updateBigMonth(id: number, b: Omit<BigMonth, "id" | "createdAt" | "planId">): void;
  deleteBigMonth(id: number): void;
  listMonthNotes(planId: string): MonthNote[];
  setMonthNote(planId: string, line: string, month: string, note: string): void;

  appendChange(entry: {
    entityType: string; entityId: string; field: string;
    oldValue: string | null; newValue: string | null; actor: string;
  }): void;
  getChangeLog(entityId: string): {
    entityType: string; entityId: string; field: string;
    oldValue: string | null; newValue: string | null; timestamp: string; actor: string;
  }[];

  upsertGoal(g: Goal): void;
  /** A goal update and its budget entries in one transaction: all of it, or none of it. */
  applyGoalChange(goal: Goal, budgetLines: BudgetLine[], goalChange?: { planId: string; line: string; fromMonth: string; deltaCents: number }): void;
  listGoals(): Goal[];
  deleteGoal(id: string): void;
  listGoalAccountLinks(): GoalAccountLink[];
  replaceGoalAccountLinks(goalId: string, links: GoalAccountLink[]): void;

  upsertWishlistItem(w: WishlistItem): void;
  listWishlistItems(): WishlistItem[];
  deleteWishlistItem(id: string): void;
  reorderWishlist(ids: string[]): void; // atomic: priority = position, from 1

  /** Also records that day's reading per account; recordedOn defaults to today, local. */
  upsertAccountBalances(rows: AccountBalance[], recordedOn?: string): void;
  getAccountBalances(): AccountBalance[];
  listBalanceReadings(): BalanceReading[];

  listScenarios(planId: string): Scenario[];
  getScenario(id: string): Scenario | null;
  upsertScenario(s: Scenario): void; // atomic: row + steps + expense deltas together
  deleteScenario(id: string): void; // cascades steps/deltas
  getWhatIf(scenarioId: string): WhatIf | null;
  listWhatIfs(planId: string): WhatIf[];
  saveWhatIf(w: WhatIf): void; // atomic: settings, changes and goal picks replaced together

  listBudgetNotes(planId: string): BudgetNote[];
  upsertBudgetNote(n: BudgetNote): void;
  deleteBudgetNote(id: string): void;

  listSnapshotHistory(planId: string): SnapshotHistoryEntry[];
  upsertSnapshotHistory(s: SnapshotHistoryEntry): void;

  listDataQualityFlags(planId: string): DataQualityFlag[];
  upsertDataQualityFlag(f: DataQualityFlag): void;
  deleteDataQualityFlag(id: string): void;

  getCategorySettings(): CategorySetting[];
  upsertCategorySetting(s: CategorySetting): void; // ON CONFLICT(planning_category) upsert
  setCategoryPinned(planningCategory: string, pinned: boolean): void;
  setCategoryRecurring(planningCategory: string, recurring: boolean | null): void; // null = back to auto

  // The user's recurring choices (migrations/0024_recurring_choices.sql).
  listRecurringChoices(): RecurringChoice[];
  upsertRecurringChoice(c: RecurringChoice): void; // ON CONFLICT(payee_key, account_id) replace
  deleteRecurringChoice(payeeKey: string, accountId: string): void;
  // Merchants (migrations/0030_merchant_renames.sql).
  listMerchantRenames(): MerchantRename[];
  upsertMerchantRename(r: MerchantRename): void; // ON CONFLICT(source_key) replace; the key ignores case
  deleteMerchantRename(sourceName: string): void;
  listSuggestionDismissals(): SuggestionDismissal[];
  addSuggestionDismissal(d: SuggestionDismissal): void; // a second dismissal of the same pair keeps the first
  deleteSuggestionDismissal(id: string): void;
  // Notes and the categorization log (migrations/0031_notes_and_categorization_log.sql).
  getRecurringChoice(payeeKey: string, accountId: string): RecurringChoice | null;
  listTransactionNotes(): TransactionNote[];
  setTransactionNote(sourceTransactionId: string, note: string, updatedAt: string): void; // an empty note deletes
  moveTransactionNote(fromId: string, toId: string): boolean; // false when toId has its own note
  listMaaserMarks(): MaaserMark[];
  setMaaserMark(mark: MaaserMarkInput, updatedAt: string): void;
  deleteMaaserMark(sourceTransactionId: string): void;
  moveMaaserMark(fromId: string, toId: string): boolean; // false when toId has its own mark
  deleteTransactionAdjustment(id: number): void;
  addCategorizationLog(e: Omit<CategorizationLogEntry, "id" | "undoneAt">): number;
  getCategorizationLog(id: number): CategorizationLogEntry | null;
  listCategorizationLog(sinceIso: string): CategorizationLogEntry[]; // newest first
  markCategorizationUndone(id: number, at: string): void;
  inTransaction<T>(fn: () => T): T;
}
