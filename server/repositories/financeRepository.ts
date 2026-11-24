// server/repositories/financeRepository.ts
//
// The future-Postgres seam: the API/services layer depends only on this
// interface, never on NodeRepository or better-sqlite3 directly. Swapping
// the local sqlite-backed app for a hosted Postgres backend later means
// writing a new class that implements FinanceRepository -- nothing above
// this layer changes.
//
// This is a typing seam, NOT a rewrite: NodeRepository (src/data/repo.node.ts)
// already implements every method below, since it implements the broader
// `Repository` interface (src/data/repo.ts) that FinanceRepository is a
// subset of.
import type { NormalizedTxn, Account } from "../../src/domain/types.js";
import type { Plan, BudgetLine, Goal, GoalAccountLink, WishlistItem, AccountBalance, BalanceReading, BudgetChange, BigMonth, MonthNote } from "../../src/domain/plan-types.js";
import type { TransactionAdjustment } from "../../src/domain/adjustments.js";
import type { Scenario } from "../../src/domain/scenario.js";
import type { WhatIf } from "../../src/domain/what-if.js";
import type { BudgetNote, SnapshotHistoryEntry, DataQualityFlag } from "../../src/domain/notes-types.js";
import type { CategorySetting } from "../../src/domain/category-settings.js";
import type { RecurringChoice } from "../../src/domain/recurring-choices.js";
import type { CategorizationLogEntry, TransactionNote } from "../../src/domain/categorizations.js";
import type { MaaserMark, MaaserMarkInput } from "../../src/domain/maaser-marks.js";
import type { MerchantRename, SuggestionDismissal } from "../../src/domain/merchants.js";
import type { CategorizationRule } from "../../src/domain/rules.js";
import type { HoldingRow, SimpleFinState } from "../../src/data/repo.js";

export interface FinanceRepository {
  getTransactions(): NormalizedTxn[];
  getAccounts(): Account[];
  setAccountIncludeInSpend(id: string, include: boolean): void;
  setAccountOwner(id: string, owner: Account["owner"]): void;
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;

  getCategoryMappings(): Record<string, string>;
  setCategoryMapping(sourceCategory: string, planningCategory: string): void;

  listPlans(): Plan[];
  getPlan(id: string): Plan | null;
  createPlan(p: Omit<Plan, "createdAt">): Plan;

  getBudgetLines(planId: string): BudgetLine[];
  setBudgetLine(line: BudgetLine): void;
  deleteBudgetLine(planId: string, planningCategory: string, period: string | null): void;
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

  listGoals(): Goal[];
  upsertGoal(g: Goal): void;
  applyGoalChange(goal: Goal, budgetLines: BudgetLine[], goalChange?: { planId: string; line: string; fromMonth: string; deltaCents: number }): void;
  deleteGoal(id: string): void;
  listGoalAccountLinks(): GoalAccountLink[];
  replaceGoalAccountLinks(goalId: string, links: GoalAccountLink[]): void;

  listWishlistItems(): WishlistItem[];
  reorderWishlist(ids: string[]): void;
  upsertWishlistItem(w: WishlistItem): void;
  deleteWishlistItem(id: string): void;

  getAccountBalances(): AccountBalance[];
  upsertAccountBalances(rows: AccountBalance[]): void;
  listBalanceReadings(): BalanceReading[];

  getTransactionAdjustments(): TransactionAdjustment[];
  addTransactionAdjustment(a: TransactionAdjustment): number;
  deleteTransactionAdjustment(id: number): void;

  listScenarios(planId: string): Scenario[];
  getScenario(id: string): Scenario | null;
  upsertScenario(s: Scenario): void; // atomic: row + steps + expense deltas together
  deleteScenario(id: string): void; // cascades steps/deltas
  getWhatIf(scenarioId: string): WhatIf | null;
  listWhatIfs(planId: string): WhatIf[];
  saveWhatIf(w: WhatIf): void;
  createWhatIf(planId: string, id: string, name: string, createdAt: string): WhatIf; // atomic: the scenario row + its empty what-if together

  listBudgetNotes(planId: string): BudgetNote[];
  upsertBudgetNote(n: BudgetNote): void;
  deleteBudgetNote(id: string): void;

  listSnapshotHistory(planId: string): SnapshotHistoryEntry[];
  upsertSnapshotHistory(s: SnapshotHistoryEntry): void;

  listDataQualityFlags(planId: string): DataQualityFlag[];
  upsertDataQualityFlag(f: DataQualityFlag): void;
  deleteDataQualityFlag(id: string): void;

  getCategorySettings(): CategorySetting[];
  upsertCategorySetting(s: CategorySetting): void;
  setCategoryPinned(planningCategory: string, pinned: boolean): void;
  setCategoryRecurring(planningCategory: string, recurring: boolean | null): void;

  listRecurringChoices(): RecurringChoice[];
  upsertRecurringChoice(c: RecurringChoice): void;
  /** Keyed by merchant, account and the amount the choice names; null = every charge (migration 0034). */
  deleteRecurringChoice(payeeKey: string, accountId: string, amountCents?: number | null): void;
  getRecurringChoice(payeeKey: string, accountId: string, amountCents?: number | null): RecurringChoice | null;

  listTransactionNotes(): TransactionNote[];
  setTransactionNote(sourceTransactionId: string, note: string, updatedAt: string): void;
  moveTransactionNote(fromId: string, toId: string): boolean;
  listMaaserMarks(): MaaserMark[];
  setMaaserMark(mark: MaaserMarkInput, updatedAt: string): void;
  deleteMaaserMark(sourceTransactionId: string): void;
  moveMaaserMark(fromId: string, toId: string): boolean;
  addCategorizationLog(e: Omit<CategorizationLogEntry, "id" | "undoneAt">): number;
  getCategorizationLog(id: number): CategorizationLogEntry | null;
  listCategorizationLog(sinceIso: string): CategorizationLogEntry[];
  markCategorizationUndone(id: number, at: string): void;
  inTransaction<T>(fn: () => T): T;

  listMerchantRenames(): MerchantRename[];
  upsertMerchantRename(r: MerchantRename): void;
  deleteMerchantRename(sourceName: string): void;
  listSuggestionDismissals(): SuggestionDismissal[];
  addSuggestionDismissal(d: SuggestionDismissal): void;
  deleteSuggestionDismissal(id: string): void;

  // --- SimpleFIN connector ---
  setAccountType(id: string, type: string | null): void;
  setAccountDrawable(id: string, drawable: boolean | null): void;
  setAccountArchived(id: string, archived: boolean): void;
  /** 'Investing', 'Retirement', or null for an ordinary account (migration 0020). */
  setAccountSavingsDestination(id: string, destination: string | null): void;
  /** The charity pot's account (migration 0033): one account at a time. */
  setAccountMaaserPot(id: string, on: boolean): void;
  retireTransactions(sourceTransactionIds: string[]): number;
  getPendingTransactions(source: string): NormalizedTxn[];
  setAccountBalance(id: string, snapshot: { balanceCents: number; availableBalanceCents: number; balanceDate: string }): void;
  replaceHoldings(accountId: string, holdings: HoldingRow[]): void;
  getHoldings(): HoldingRow[];
  getSimpleFinState(): SimpleFinState | null;
  setSimpleFinState(state: SimpleFinState): void;
  getTransactionSource(sourceTransactionId: string): string | null;

  // --- Categorization rules ---
  getCategorizationRules(): CategorizationRule[];
  addCategorizationRule(rule: Omit<CategorizationRule, "id">): number;
  addCategorizationRules(rules: Omit<CategorizationRule, "id">[]): number;
  deleteCategorizationRule(id: number): void;
}
