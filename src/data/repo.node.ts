// src/data/repo.node.ts
import Database from "better-sqlite3";
import { applyYearlyShares } from "../domain/budget-changes.js";
import { readYearlyShares, yearlyShareFor } from "./yearly-costs.store.js";
import { applyMigrations, checkDatabaseVersion, OlderDatabaseError } from "./migrate.node.js";
import type { Repository, UpsertResult } from "./repo";
import type { NormalizedTxn, Account } from "../domain/types";
import type { HoldingRow, SimpleFinState } from "./repo";
import type { CategorizationRule } from "../domain/rules";
import type { Plan, BudgetLine, Goal, GoalAccountLink, WishlistItem, AccountBalance, BalanceReading, BudgetChange, BigMonth, MonthNote } from "../domain/plan-types";
import { localDateIso } from "../domain/period";
import { toOwnerSlot, type OwnerSlot } from "../domain/household";
import type { TransactionAdjustment } from "../domain/adjustments";
import type { Scenario, IncomeRampModel, LineOverride } from "../domain/scenario";
import { isEmptyOverride } from "../domain/scenario";
import type { LoanInputs, WhatIf, WhatIfChange, WhatIfRow } from "../domain/what-if";
import type { BudgetNote, SnapshotHistoryEntry, DataQualityFlag } from "../domain/notes-types";
import type { CategorySetting } from "../domain/category-settings";
import type { RecurringChoice } from "../domain/recurring-choices";
import type { MerchantRename, SuggestionDismissal } from "../domain/merchants";
import type { CategorizationLogEntry, TransactionNote } from "../domain/categorizations";
import type { MaaserMark, MaaserMarkInput } from "../domain/maaser-marks";

/** One categorization_log row (migration 0031) as the domain shape. */
function logRow(r: any): CategorizationLogEntry {
  return {
    id: r.id, createdAt: r.created_at, sourceTransactionId: r.source_transaction_id, label: r.label,
    fromCategory: r.from_category, toCategory: r.to_category, ruleId: r.rule_id ?? null, adjustmentId: r.adjustment_id ?? null,
    recurringPayeeKey: r.recurring_payee_key ?? null, recurringAccountId: r.recurring_account_id ?? null,
    priorRecurringChoice: r.prior_recurring_choice_json ? JSON.parse(r.prior_recurring_choice_json) : null,
    writtenRecurringChoice: r.written_recurring_choice_json ? JSON.parse(r.written_recurring_choice_json) : null,
    undoneAt: r.undone_at ?? null,
  };
}

/** A what-if's additional salary as its three columns (migrations/0028). Null = the one in Settings, Salary. */
function additionalColumns(a: WhatIf["additionalSalary"]): [string | null, number | null, string | null] {
  if (a === undefined || a === null) return [null, null, null];
  if (a === "none") return ["none", null, null];
  return a.kind === "w2" ? ["w2", a.grossAnnualCents, a.fromPeriod] : ["monthly", a.monthlyCents, a.fromPeriod];
}

export class NodeRepository implements Repository {
  private db: Database.Database;
  /** For feature stores only: they keep their own tables here. Not for the main repository methods. */
  connection(): Database.Database {
    return this.db;
  }
  constructor(dbPath: string) {
    if (checkDatabaseVersion(dbPath) === "older") throw new OlderDatabaseError();
    this.db = new Database(dbPath);
    try {
      this.db.pragma("journal_mode = WAL");
      applyMigrations(this.db);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  upsertAccounts(accounts: Account[]): void {
    // ON CONFLICT deliberately does NOT update is_owned/include_in_spend/owner: those are user-editable local toggles a re-sync must never clobber.
    //
    // `type` is the same kind of user-owned value, and SimpleFIN makes it acute:
    // that feed has NO type/subtype field at all, so every sync arrives with
    // type:null. Writing that through would erase the typing that drives
    // drawable, retirement exclusion and liability sign -- silently, daily. So
    // a null incoming type keeps what's there, and once type_source='user' the
    // feed can never override it again.
    const stmt = this.db.prepare(`
      INSERT INTO accounts (id, name, type, institution, currency, is_owned, include_in_spend, type_source)
      VALUES (@id, @name, @type, @institution, @currency, @is_owned, @include_in_spend, 'feed')
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,
        institution=excluded.institution, currency=excluded.currency,
        type = CASE
          WHEN accounts.type_source = 'user' THEN accounts.type
          WHEN excluded.type IS NULL THEN accounts.type
          ELSE excluded.type
        END`);
    const tx = this.db.transaction((rows: Account[]) => {
      for (const a of rows) stmt.run({
        id: a.id, name: a.name, type: a.type, institution: a.institution,
        currency: a.currency, is_owned: a.isOwned ? 1 : 0, include_in_spend: a.includeInSpend ? 1 : 0,
      });
    });
    tx(accounts);
  }

  upsertTransactions(txns: NormalizedTxn[], source: string = "monarch"): UpsertResult {
    const now = new Date().toISOString();
    const exists = this.db.prepare("SELECT 1 FROM transactions WHERE source_transaction_id = ?");
    const insert = this.db.prepare(`
      INSERT INTO transactions (source_transaction_id, account_id, date, amount_cents, source_category,
        merchant, is_transfer, source_updated_at, first_seen_at, last_seen_at, sync_version, is_deleted,
        description, memo, payee, mcc, pending, source)
      VALUES (@sid, @acc, @date, @amt, @cat, @merch, @xfer, @sua, @now, @now, 1, 0,
        @desc, @memo, @payee, @mcc, @pending, @source)`);
    // The incremental fetch overlaps 5 days on purpose, so re-sending a row it
    // already sent has to be free -- and a pending row that later settles has to
    // update in place (same id, new date and pending=0) rather than duplicate.
    // is_deleted is deliberately NOT touched: a retired row (a pending hold the
    // settle pass matched, a Monarch row the seam re-cut superseded) stays
    // retired however often the feed or a re-imported CSV re-sends its id.
    const update = this.db.prepare(`
      UPDATE transactions SET account_id=@acc, date=@date, amount_cents=@amt, source_category=@cat,
        merchant=@merch, is_transfer=@xfer, source_updated_at=@sua, last_seen_at=@now,
        description=@desc, memo=@memo, payee=@payee, mcc=@mcc, pending=@pending, source=@source,
        sync_version=sync_version+1 WHERE source_transaction_id=@sid`);
    let inserted = 0, updated = 0;
    const run = this.db.transaction((rows: NormalizedTxn[]) => {
      for (const t of rows) {
        const p = { sid: t.sourceTransactionId, acc: t.accountId, date: t.date, amt: t.amountCents,
          cat: t.sourceCategory, merch: t.merchant, xfer: t.isTransfer ? 1 : 0, sua: t.sourceUpdatedAt, now,
          desc: t.description ?? null, memo: t.memo ?? null, payee: t.payee ?? null,
          mcc: t.mcc ?? null, pending: t.pending ? 1 : 0, source };
        if (exists.get(t.sourceTransactionId)) { update.run(p); updated++; }
        else { insert.run(p); inserted++; }
      }
    });
    run(txns);
    return { inserted, updated };
  }

  private static rowToTxn(r: any): NormalizedTxn {
    return {
      sourceTransactionId: r.source_transaction_id, accountId: r.account_id, date: r.date,
      amountCents: r.amount_cents, sourceCategory: r.source_category, merchant: r.merchant,
      isTransfer: !!r.is_transfer, sourceUpdatedAt: r.source_updated_at,
      description: r.description ?? null, memo: r.memo ?? null, payee: r.payee ?? null,
      mcc: r.mcc ?? null, pending: !!r.pending,
    };
  }

  getTransactions(): NormalizedTxn[] {
    return this.db.prepare("SELECT * FROM transactions WHERE is_deleted=0 ORDER BY date").all().map(NodeRepository.rowToTxn);
  }

  /**
   * Live pending rows from one feed. The pending->posted safeguard in the
   * SimpleFIN sync compares these against each window's posted rows; Monarch
   * history is excluded so a legacy row can never be mistaken for a settle.
   */
  getPendingTransactions(source: string): NormalizedTxn[] {
    return this.db
      .prepare("SELECT * FROM transactions WHERE is_deleted=0 AND pending=1 AND source=? ORDER BY date")
      .all(source)
      .map(NodeRepository.rowToTxn);
  }

  /** Which feed a row came from ('monarch' | 'simplefin' | 'csv'). */
  getTransactionSource(sourceTransactionId: string): string | null {
    const r: any = this.db.prepare("SELECT source FROM transactions WHERE source_transaction_id=?").get(sourceTransactionId);
    return r ? r.source : null;
  }

  getAccounts(): Account[] {
    return this.db.prepare("SELECT * FROM accounts").all().map((r: any) => ({
      id: r.id, name: r.name, type: r.type, institution: r.institution, currency: r.currency,
      isOwned: !!r.is_owned, includeInSpend: !!r.include_in_spend,
      owner: toOwnerSlot(r.owner ?? null),
      typeSource: (r.type_source ?? "feed") as Account["typeSource"],
      balanceCents: r.balance_cents ?? null,
      availableBalanceCents: r.available_balance_cents ?? null,
      balanceDate: r.balance_date ?? null,
      drawable: r.drawable === null || r.drawable === undefined ? undefined : !!r.drawable,
      archived: !!r.archived,
      savingsDestination: r.savings_destination ?? null,
      maaserPot: !!r.maaser_pot,
    }));
  }

  /**
   * Whether this account's balance counts toward drawable cash. Passing null
   * clears the choice, restoring the default rule.
   */
  setAccountDrawable(id: string, drawable: boolean | null): void {
    this.db.prepare("UPDATE accounts SET drawable=? WHERE id=?").run(drawable === null ? null : drawable ? 1 : 0, id);
  }

  /**
   * Retires transactions by marking them deleted rather than dropping the
   * rows. Reversible: a mistaken seam re-cut is then an UPDATE away from being
   * undone instead of a restore-from-backup.
   */
  retireTransactions(sourceTransactionIds: string[]): number {
    const stmt = this.db.prepare("UPDATE transactions SET is_deleted=1 WHERE source_transaction_id=? AND is_deleted=0");
    const run = this.db.transaction((ids: string[]) => {
      let n = 0;
      for (const id of ids) n += stmt.run(id).changes;
      return n;
    });
    return run(sourceTransactionIds);
  }

  /**
   * Hides a superseded account record from the UI. The row keeps its
   * transactions, which still count everywhere. Its BALANCE does not: an
   * archived balance is left out of drawable, net worth and goals, because the
   * live record already reports the same money.
   */
  setAccountArchived(id: string, archived: boolean): void {
    this.db.prepare("UPDATE accounts SET archived=? WHERE id=?").run(archived ? 1 : 0, id);
  }

  /**
   * The user typing an account. Stamps type_source='user' so no later sync can
   * override it -- SimpleFIN supplies no type, and getting this wrong means a
   * credit card's positive balance reads as an asset in drawable.
   */
  setAccountType(id: string, type: string | null): void {
    this.db.prepare("UPDATE accounts SET type=?, type_source='user' WHERE id=?").run(type, id);
  }

  setAccountBalance(
    id: string,
    snapshot: { balanceCents: number; availableBalanceCents: number; balanceDate: string }
  ): void {
    this.db.prepare(
      "UPDATE accounts SET balance_cents=?, available_balance_cents=?, balance_date=? WHERE id=?"
    ).run(snapshot.balanceCents, snapshot.availableBalanceCents, snapshot.balanceDate, id);
  }

  /**
   * Where money put away in this account lands: 'Investing', 'Retirement', or
   * null for an ordinary spending or cash account. Setting it makes every move
   * INTO this account from an unflagged one count as saving, and silences the
   * account's own internal rows. See src/domain/savings.ts.
   */
  /**
   * The maaser pot (migration 0033): one LIVE account at a time, so switching a live row on
   * clears the other live rows. An archived row (the superseded record of the same bank
   * account, holding its older history) may carry the flag alongside.
   */
  setAccountMaaserPot(id: string, on: boolean): void {
    this.inTransaction(() => {
      const row: any = this.db.prepare("SELECT archived FROM accounts WHERE id=?").get(id);
      if (!row) throw new Error("No account with that id.");
      if (on && !row.archived) this.db.prepare("UPDATE accounts SET maaser_pot=0 WHERE maaser_pot=1 AND archived=0").run();
      this.db.prepare("UPDATE accounts SET maaser_pot=? WHERE id=?").run(on ? 1 : 0, id);
    });
  }

  setAccountSavingsDestination(id: string, destination: string | null): void {
    this.db.prepare("UPDATE accounts SET savings_destination=? WHERE id=?").run(destination, id);
  }

  setAccountIncludeInSpend(id: string, include: boolean): void {
    this.db.prepare("UPDATE accounts SET include_in_spend=? WHERE id=?").run(include ? 1 : 0, id);
  }

  setAccountOwner(id: string, owner: OwnerSlot): void {
    this.db.prepare("UPDATE accounts SET owner=? WHERE id=?").run(owner, id);
  }

  // --- Categorization rules ---------------------------------------------------

  getCategorizationRules(): CategorizationRule[] {
    // Priority order, id as the tiebreak, so first-match-wins is deterministic.
    return this.db.prepare("SELECT * FROM categorization_rules ORDER BY priority, id").all().map((r: any) => ({
      id: r.id, priority: r.priority,
      memoContains: r.memo_contains, payeeContains: r.payee_contains,
      descriptionContains: r.description_contains, mcc: r.mcc, accountId: r.account_id,
      amountCents: r.amount_cents, amountMinCents: r.amount_min_cents, amountMaxCents: r.amount_max_cents,
      action: r.action, toCategory: r.to_category, note: r.note,
    }));
  }

  addCategorizationRule(rule: Omit<CategorizationRule, "id">): number {
    const info = this.ruleInsertStatement().run(this.ruleParams(rule));
    return Number(info.lastInsertRowid);
  }

  /** Bulk insert, used by the one-time bootstrap from Monarch history. */
  addCategorizationRules(rules: Omit<CategorizationRule, "id">[]): number {
    const stmt = this.ruleInsertStatement();
    const tx = this.db.transaction((rows: Omit<CategorizationRule, "id">[]) => {
      for (const r of rows) stmt.run(this.ruleParams(r));
    });
    tx(rules);
    return rules.length;
  }

  deleteCategorizationRule(id: number): void {
    this.db.prepare("DELETE FROM categorization_rules WHERE id=?").run(id);
  }

  private ruleInsertStatement() {
    return this.db.prepare(`
      INSERT INTO categorization_rules (priority, memo_contains, payee_contains, description_contains,
        mcc, account_id, amount_cents, amount_min_cents, amount_max_cents, action, to_category, note)
      VALUES (@priority, @memo_contains, @payee_contains, @description_contains,
        @mcc, @account_id, @amount_cents, @amount_min_cents, @amount_max_cents, @action, @to_category, @note)`);
  }

  private ruleParams(r: Omit<CategorizationRule, "id">) {
    return {
      priority: r.priority ?? 100,
      memo_contains: r.memoContains ?? null,
      payee_contains: r.payeeContains ?? null,
      description_contains: r.descriptionContains ?? null,
      mcc: r.mcc ?? null,
      account_id: r.accountId ?? null,
      amount_cents: r.amountCents ?? null,
      amount_min_cents: r.amountMinCents ?? null,
      amount_max_cents: r.amountMaxCents ?? null,
      action: r.action ?? "categorize",
      to_category: r.toCategory ?? null,
      note: r.note ?? null,
    };
  }

  // --- SimpleFIN connector ---------------------------------------------------

  /**
   * Investment positions are a SNAPSHOT, not an append-only log: each sync
   * replaces the whole set for that account. Scoped per account so one
   * institution's refresh never clears another's.
   */
  replaceHoldings(accountId: string, holdings: HoldingRow[]): void {
    const asOf = new Date().toISOString();
    const del = this.db.prepare("DELETE FROM holdings WHERE account_id=?");
    const ins = this.db.prepare(`
      INSERT INTO holdings (account_id, symbol, description, shares, cost_basis_cents,
        market_value_cents, purchase_price_cents, currency, as_of)
      VALUES (@account_id, @symbol, @description, @shares, @cost_basis_cents,
        @market_value_cents, @purchase_price_cents, @currency, @as_of)`);
    const tx = this.db.transaction((rows: HoldingRow[]) => {
      del.run(accountId);
      for (const h of rows) ins.run({
        account_id: accountId, symbol: h.symbol, description: h.description, shares: h.shares,
        cost_basis_cents: h.costBasisCents, market_value_cents: h.marketValueCents,
        purchase_price_cents: h.purchasePriceCents, currency: h.currency, as_of: asOf,
      });
    });
    tx(holdings);
  }

  getHoldings(): HoldingRow[] {
    return this.db.prepare("SELECT * FROM holdings ORDER BY account_id, symbol").all().map((r: any) => ({
      accountId: r.account_id, symbol: r.symbol, description: r.description, shares: r.shares,
      costBasisCents: r.cost_basis_cents, marketValueCents: r.market_value_cents,
      purchasePriceCents: r.purchase_price_cents, currency: r.currency,
    }));
  }

  getSimpleFinState(): SimpleFinState | null {
    const r: any = this.db.prepare("SELECT * FROM simplefin_state WHERE id=1").get();
    if (!r) return null;
    return {
      accessUrl: r.access_url ?? null,
      lastSyncedAt: r.last_synced_at ?? null,
      earliestBackfilled: r.earliest_backfilled ?? null,
      lastErrors: JSON.parse(r.last_errors ?? "[]"),
    };
  }

  setSimpleFinState(state: SimpleFinState): void {
    this.db.prepare(`
      INSERT INTO simplefin_state (id, access_url, last_synced_at, earliest_backfilled, last_errors)
      VALUES (1, @access_url, @last_synced_at, @earliest_backfilled, @last_errors)
      ON CONFLICT(id) DO UPDATE SET access_url=excluded.access_url,
        last_synced_at=excluded.last_synced_at, earliest_backfilled=excluded.earliest_backfilled,
        last_errors=excluded.last_errors`).run({
      access_url: state.accessUrl, last_synced_at: state.lastSyncedAt,
      earliest_backfilled: state.earliestBackfilled, last_errors: JSON.stringify(state.lastErrors ?? []),
    });
  }

  // App-owned key/value settings (the app_settings table).
  getSetting(key: string): string | null {
    const r: any = this.db.prepare("SELECT value FROM app_settings WHERE key=?").get(key);
    return r ? r.value : null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
  }

  getCategoryMappings(): Record<string, string> {
    const rows = this.db.prepare("SELECT source_category, planning_category FROM category_mappings").all() as any[];
    return Object.fromEntries(rows.map((r) => [r.source_category, r.planning_category]));
  }

  setCategoryMapping(sourceCategory: string, planningCategory: string): void {
    this.db.prepare(`INSERT INTO category_mappings (source_category, planning_category) VALUES (?, ?)
      ON CONFLICT(source_category) DO UPDATE SET planning_category=excluded.planning_category`)
      .run(sourceCategory, planningCategory);
  }

  lastSyncedDate(): string | null {
    const r: any = this.db.prepare("SELECT MAX(date) AS d FROM transactions WHERE is_deleted=0").get();
    return r?.d ?? null;
  }

  createPlan(p: Omit<Plan, "createdAt">): Plan {
    const createdAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO plans (id, name, start_date, end_date, created_at)
      VALUES (?,?,?,?,?)`).run(p.id, p.name, p.startDate, p.endDate, createdAt);
    return { ...p, createdAt };
  }

  getPlan(id: string): Plan | null {
    const r: any = this.db.prepare("SELECT * FROM plans WHERE id=?").get(id);
    return r ? { id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date, createdAt: r.created_at } : null;
  }

  listPlans(): Plan[] {
    return this.db.prepare("SELECT * FROM plans ORDER BY id").all().map((r: any) => ({
      id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date, createdAt: r.created_at }));
  }

  // Domain represents a default (all-months) line as period === null; the DB column is
  // NOT NULL DEFAULT '' so the boundary maps ''<->null here (not in the DB layer).
  // Reads the prior amount, upserts, and appends a change_log row inside a single
  // transaction so the budget write and its audit row commit atomically.
  setBudgetLine(line: BudgetLine): void {
    const periodKey = line.period ?? "";
    const entityId = `${line.planId}:${line.planningCategory}:${periodKey}`;
    // Who set an every-month amount (migration 0032): the caller's word, else what the row already says.
    const source = periodKey === "" ? line.source ?? null : null;
    const tx = this.db.transaction(() => {
      const share = yearlyShareFor(this.db, line.planId, line.planningCategory);
      const prev: any = this.db.prepare(
        "SELECT amount_cents FROM budget_lines WHERE plan_id=? AND planning_category=? AND period=?"
      ).get(line.planId, line.planningCategory, periodKey);
      this.db.prepare(`INSERT INTO budget_lines (plan_id, planning_category, period, amount_cents, source)
        VALUES (@plan, @cat, @period, @amt, COALESCE(@source, 'suggested'))
        ON CONFLICT(plan_id, planning_category, period) DO UPDATE SET amount_cents=excluded.amount_cents,
          source=COALESCE(@source, budget_lines.source)`)
        .run({ plan: line.planId, cat: line.planningCategory, period: periodKey, amt: line.amountCents + share, source });
      this.appendChange({
        entityType: "budget_line", entityId, field: "amount_cents",
        oldValue: prev ? String(prev.amount_cents - share) : null, newValue: String(line.amountCents), actor: "USER",
      });
    });
    tx();
  }

  getBudgetLines(planId: string): BudgetLine[] {
    const rows = this.db.prepare("SELECT * FROM budget_lines WHERE plan_id=? ORDER BY planning_category, period").all(planId)
      .map((r: any) => r.period === ""
        ? { planId: r.plan_id, planningCategory: r.planning_category, period: null, amountCents: r.amount_cents, source: r.source }
        : { planId: r.plan_id, planningCategory: r.planning_category, period: r.period, amountCents: r.amount_cents });
    return applyYearlyShares(rows, readYearlyShares(this.db, planId));
  }

  // Same ''<->null period boundary as setBudgetLine/getBudgetLines. Used to
  // revert a per-month override back to the category's default (period: null).
  deleteBudgetLine(planId: string, planningCategory: string, period: string | null): void {
    const p = period ?? "";
    this.db.prepare("DELETE FROM budget_lines WHERE plan_id=? AND planning_category=? AND period=?")
      .run(planId, planningCategory, p);
  }

  // Budget changes (migration 0032). Every write is one transaction with its change_log row.
  private changeRow(r: any): BudgetChange {
    return { id: r.id, planId: r.plan_id, planningCategory: r.planning_category, fromMonth: r.from_month,
      amountCents: r.amount_cents, reason: r.reason, goalId: r.goal_id ?? null, createdAt: r.created_at };
  }
  listBudgetChanges(planId: string): BudgetChange[] {
    return this.db.prepare("SELECT * FROM budget_changes WHERE plan_id=? ORDER BY planning_category, from_month, id")
      .all(planId).map((r: any) => this.changeRow(r));
  }
  private changedRows(planId: string, line: string, fromMonth: string | null): BudgetChange[] {
    const sql = fromMonth === null
      ? "SELECT * FROM budget_changes WHERE plan_id=? AND planning_category=? AND reason='changed' ORDER BY from_month"
      : "SELECT * FROM budget_changes WHERE plan_id=? AND planning_category=? AND reason='changed' AND from_month>=? ORDER BY from_month";
    const args = fromMonth === null ? [planId, line] : [planId, line, fromMonth];
    return this.db.prepare(sql).all(...args).map((r: any) => this.changeRow(r));
  }
  private dropChanged(planId: string, line: string, rows: BudgetChange[]): void {
    const del = this.db.prepare("DELETE FROM budget_changes WHERE id=?");
    for (const c of rows) del.run(c.id);
    if (rows.length > 0) this.appendChange({ entityType: "budget_change", entityId: `budget_change:${planId}:${line}`,
      field: "cleared", oldValue: JSON.stringify(rows.map((c) => [c.fromMonth, c.amountCents])), newValue: null, actor: "USER" });
  }
  /** The user's "from this month on": replaces that month's and later changed rows; returns only the LATER ones replaced. */
  changeLineFrom(planId: string, line: string, fromMonth: string, amountCents: number): BudgetChange[] {
    let replaced: BudgetChange[] = [];
    this.db.transaction(() => {
      replaced = this.changedRows(planId, line, fromMonth);
      const later = replaced.filter((c) => c.fromMonth > fromMonth);
      this.db.prepare("DELETE FROM budget_changes WHERE plan_id=? AND planning_category=? AND reason='changed' AND from_month>=?")
        .run(planId, line, fromMonth);
      this.db.prepare(`INSERT INTO budget_changes (plan_id, planning_category, from_month, amount_cents, reason, goal_id, created_at)
        VALUES (?,?,?,?, 'changed', NULL, ?)`).run(planId, line, fromMonth, amountCents, new Date().toISOString());
      this.appendChange({ entityType: "budget_change", entityId: `budget_change:${planId}:${line}`, field: `from ${fromMonth}`,
        oldValue: JSON.stringify(replaced.map((c) => [c.fromMonth, c.amountCents])), newValue: String(amountCents), actor: "USER" });
      // A change on the very same month is an edit of that change, not news; only later ones are reported.
      replaced = later;
    })();
    return replaced;
  }
  setLineEveryMonth(planId: string, line: string, amountCents: number): BudgetChange[] {
    let replaced: BudgetChange[] = [];
    this.db.transaction(() => {
      replaced = this.changedRows(planId, line, null);
      this.dropChanged(planId, line, replaced);
      this.setBudgetLine({ planId, planningCategory: line, period: null, amountCents, source: "you" });
    })();
    return replaced;
  }
  resetLine(planId: string, line: string, suggestedCents: number): BudgetChange[] {
    let cleared: BudgetChange[] = [];
    this.db.transaction(() => {
      cleared = this.changedRows(planId, line, null);
      this.dropChanged(planId, line, cleared);
      this.setBudgetLine({ planId, planningCategory: line, period: null, amountCents: suggestedCents, source: "suggested" });
    })();
    return cleared;
  }
  /**
   * Set up budget's Apply: each picked line goes back to
   * the given amount with the user's changes on it cleared, and the review date is stamped, in one
   * transaction. "last_seed_at" is settingsService's LAST_SEED_AT_KEY (the Dashboard's
   * 90-day "Review your budget" clock).
   */
  applySetup(planId: string, picks: { line: string; amountCents: number }[], stampIso: string): BudgetChange[] {
    let cleared: BudgetChange[] = [];
    this.db.transaction(() => {
      for (const p of picks) cleared = [...cleared, ...this.resetLine(planId, p.line, p.amountCents)];
      this.setSetting("last_seed_at", stampIso);
    })();
    return cleared;
  }
  /** Start next year's budget: the plan and every line in one transaction, or nothing. */
  startPlanWithLines(
    plan: Omit<Plan, "createdAt">,
    lines: { line: string; amountCents: number; source: "you" | "suggested" }[],
    stampIso: string,
  ): Plan {
    let made: Plan | null = null;
    this.db.transaction(() => {
      made = this.createPlan(plan);
      for (const l of lines) this.setBudgetLine({ planId: plan.id, planningCategory: l.line, period: null, amountCents: l.amountCents, source: l.source });
      this.setSetting("last_seed_at", stampIso);
    })();
    if (!made) throw new Error("The budget was not created.");
    return made;
  }
  addGoalChange(planId: string, line: string, fromMonth: string, deltaCents: number, goalId: string): void {
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO budget_changes (plan_id, planning_category, from_month, amount_cents, reason, goal_id, created_at)
        VALUES (?,?,?,?, 'goal', ?, ?)`).run(planId, line, fromMonth, deltaCents, goalId, new Date().toISOString());
      this.appendChange({ entityType: "budget_change", entityId: `budget_change:${planId}:${line}`, field: `goal ${goalId} from ${fromMonth}`,
        oldValue: null, newValue: String(deltaCents), actor: "USER" });
    })();
  }

  // Planned big months (migration 0032).
  private bigRow(r: any): BigMonth {
    return { id: r.id, planId: r.plan_id, planningCategory: r.planning_category, month: r.month, label: r.label,
      amountCents: r.amount_cents, createdAt: r.created_at };
  }
  listBigMonths(planId: string): BigMonth[] {
    return this.db.prepare("SELECT * FROM budget_big_months WHERE plan_id=? ORDER BY month, id").all(planId).map((r: any) => this.bigRow(r));
  }
  getBigMonth(id: number): BigMonth | null {
    const r = this.db.prepare("SELECT * FROM budget_big_months WHERE id=?").get(id);
    return r ? this.bigRow(r) : null;
  }
  // Each big month and note write is one
  // transaction with its change_log row, as the budget changes are.
  private logBig(id: number, field: string, before: BigMonth | null, after: Omit<BigMonth, "id" | "createdAt" | "planId"> | null): void {
    const show = (b: Omit<BigMonth, "id" | "createdAt" | "planId"> | null) =>
      b ? JSON.stringify([b.planningCategory, b.month, b.label, b.amountCents]) : null;
    this.appendChange({ entityType: "big_month", entityId: `big_month:${id}`, field, oldValue: show(before), newValue: show(after), actor: "USER" });
  }
  addBigMonth(b: Omit<BigMonth, "id" | "createdAt">): BigMonth {
    const createdAt = new Date().toISOString();
    let id = 0;
    this.db.transaction(() => {
      const info = this.db.prepare(`INSERT INTO budget_big_months (plan_id, planning_category, month, label, amount_cents, created_at)
        VALUES (?,?,?,?,?,?)`).run(b.planId, b.planningCategory, b.month, b.label, b.amountCents, createdAt);
      id = Number(info.lastInsertRowid);
      this.logBig(id, "added", null, b);
    })();
    return { ...b, id, createdAt };
  }
  updateBigMonth(id: number, b: Omit<BigMonth, "id" | "createdAt" | "planId">): void {
    this.db.transaction(() => {
      const before = this.getBigMonth(id);
      this.db.prepare("UPDATE budget_big_months SET planning_category=?, month=?, label=?, amount_cents=? WHERE id=?")
        .run(b.planningCategory, b.month, b.label, b.amountCents, id);
      this.logBig(id, "changed", before, b);
    })();
  }
  deleteBigMonth(id: number): void {
    this.db.transaction(() => {
      const before = this.getBigMonth(id);
      this.db.prepare("DELETE FROM budget_big_months WHERE id=?").run(id);
      if (before) this.logBig(id, "deleted", before, null);
    })();
  }

  // A note on one line for one month (migration 0032). Blank deletes.
  listMonthNotes(planId: string): MonthNote[] {
    return this.db.prepare("SELECT * FROM budget_month_notes WHERE plan_id=? ORDER BY month, planning_category").all(planId)
      .map((r: any) => ({ planId: r.plan_id, planningCategory: r.planning_category, month: r.month, note: r.note, updatedAt: r.updated_at }));
  }
  setMonthNote(planId: string, line: string, month: string, note: string): void {
    const text = note.trim();
    this.db.transaction(() => {
      const before = (this.db.prepare("SELECT note FROM budget_month_notes WHERE plan_id=? AND planning_category=? AND month=?")
        .get(planId, line, month) as { note: string } | undefined)?.note ?? null;
      if (text === "") {
        this.db.prepare("DELETE FROM budget_month_notes WHERE plan_id=? AND planning_category=? AND month=?").run(planId, line, month);
      } else {
        this.db.prepare(`INSERT INTO budget_month_notes (plan_id, planning_category, month, note, updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(plan_id, planning_category, month) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at`)
          .run(planId, line, month, text, new Date().toISOString());
      }
      if (before !== (text === "" ? null : text)) {
        this.appendChange({ entityType: "month_note", entityId: `month_note:${planId}:${line}:${month}`, field: "note",
          oldValue: before, newValue: text === "" ? null : text, actor: "USER" });
      }
    })();
  }

  appendChange(entry: {
    entityType: string; entityId: string; field: string;
    oldValue: string | null; newValue: string | null; actor: string;
  }): void {
    this.db.prepare(`INSERT INTO change_log (entity_type, entity_id, field, old_value, new_value, timestamp, actor)
      VALUES (@entityType, @entityId, @field, @oldValue, @newValue, @ts, @actor)`)
      .run({ ...entry, ts: new Date().toISOString() });
  }

  getChangeLog(entityId: string) {
    return this.db.prepare("SELECT * FROM change_log WHERE entity_id=? ORDER BY id").all(entityId).map((r: any) => ({
      entityType: r.entity_type, entityId: r.entity_id, field: r.field,
      oldValue: r.old_value, newValue: r.new_value, timestamp: r.timestamp, actor: r.actor,
    }));
  }

  // Goals (migrations/0003, rebuilt by 0018 for Monarch parity). The optional
  // fields default here too, so a caller still sending 0003's six-field shape
  // (older CLI scripts, the security test's payload) writes a valid row.
  upsertGoal(g: Goal): void {
    this.db.prepare(`INSERT INTO goals (id, name, goal_type, target_amount_cents, target_date, priority, current_amount_cents,
        planned_monthly_cents, notes, archived_at, ongoing_monthly_cents, ongoing_started_period, ongoing_budget_line, completed_at)
      VALUES (@id,@name,@type,@target,@date,@priority,@current,@planned,@notes,@archived,@ongoing,@started,@line,@completed)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, goal_type=excluded.goal_type,
        target_amount_cents=excluded.target_amount_cents, target_date=excluded.target_date, priority=excluded.priority,
        current_amount_cents=excluded.current_amount_cents, planned_monthly_cents=excluded.planned_monthly_cents,
        notes=excluded.notes, archived_at=excluded.archived_at,
        -- A field the caller left out (the CLI, an older payload) keeps its stored value; null clears it
        -- (a rebuilt goal must never erase a started cost's marks).
        ongoing_monthly_cents=CASE WHEN @hasOngoing THEN excluded.ongoing_monthly_cents ELSE goals.ongoing_monthly_cents END,
        ongoing_started_period=CASE WHEN @hasStarted THEN excluded.ongoing_started_period ELSE goals.ongoing_started_period END,
        ongoing_budget_line=CASE WHEN @hasLine THEN excluded.ongoing_budget_line ELSE goals.ongoing_budget_line END,
        completed_at=CASE WHEN @hasCompleted THEN excluded.completed_at ELSE goals.completed_at END`)
      .run({
        id: g.id, name: g.name, type: g.goalType ?? "savings", target: g.targetAmountCents, date: g.targetDate ?? null,
        priority: g.priority, current: g.currentAmountCents, planned: g.plannedMonthlyCents ?? 0, notes: g.notes ?? "",
        archived: g.archivedAt ?? null,
        ongoing: g.ongoingMonthlyCents ?? 0, started: g.ongoingStartedPeriod ?? null, line: g.ongoingBudgetLine ?? null, completed: g.completedAt ?? null,
        hasOngoing: g.ongoingMonthlyCents === undefined ? 0 : 1, hasStarted: g.ongoingStartedPeriod === undefined ? 0 : 1,
        hasLine: g.ongoingBudgetLine === undefined ? 0 : 1, hasCompleted: g.completedAt === undefined ? 0 : 1,
      });
  }
  /** A goal update and its budget entries in one transaction: all of it, or none of it. */
  applyGoalChange(goal: Goal, budgetLines: BudgetLine[], goalChange?: { planId: string; line: string; fromMonth: string; deltaCents: number }): void {
    this.db.transaction(() => {
      this.upsertGoal(goal);
      for (const line of budgetLines) this.setBudgetLine(line);
      if (goalChange) this.addGoalChange(goalChange.planId, goalChange.line, goalChange.fromMonth, goalChange.deltaCents, goal.id);
    })();
  }
  listGoals(): Goal[] {
    return this.db.prepare("SELECT * FROM goals ORDER BY priority, id").all().map((r: any) => ({
      id: r.id, name: r.name, goalType: r.goal_type, targetAmountCents: r.target_amount_cents, targetDate: r.target_date,
      priority: r.priority, currentAmountCents: r.current_amount_cents, plannedMonthlyCents: r.planned_monthly_cents,
      notes: r.notes, archivedAt: r.archived_at,
      ongoingMonthlyCents: r.ongoing_monthly_cents ?? 0, ongoingStartedPeriod: r.ongoing_started_period ?? null,
      ongoingBudgetLine: r.ongoing_budget_line ?? null, completedAt: r.completed_at ?? null }));
  }
  // Explicit child delete, the deleteScenario convention. better-sqlite3 turns
  // PRAGMA foreign_keys on by default, so 0018's ON DELETE
  // CASCADE already removes the links; deleting them here as well keeps the
  // behavior independent of that driver default. Fault-injecting this line
  // out leaves tests/data/goals-wishlist-balances.test.ts green for exactly
  // that reason (an equivalent mutant, not a missing assertion).
  deleteGoal(id: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM goal_account_links WHERE goal_id=?").run(id);
      this.db.prepare("DELETE FROM goals WHERE id=?").run(id);
    });
    tx();
  }

  // Goal account links (migrations/0018): which accounts fund a goal, by
  // entire balance or a fixed slice. Replace-all per goal, in one transaction,
  // so the partial UNIQUE index (one entire-balance goal per account) refusing
  // a row leaves the goal's previous links exactly as they were.
  listGoalAccountLinks(): GoalAccountLink[] {
    return this.db.prepare("SELECT goal_id, account_id, mode, amount_cents FROM goal_account_links ORDER BY goal_id, account_id")
      .all().map((r: any) => ({ goalId: r.goal_id, accountId: r.account_id, mode: r.mode, amountCents: r.amount_cents }));
  }
  replaceGoalAccountLinks(goalId: string, links: GoalAccountLink[]): void {
    const insert = this.db.prepare(`INSERT INTO goal_account_links (goal_id, account_id, mode, amount_cents, updated_at)
      VALUES (@goal,@acc,@mode,@amount,@at)`);
    const tx = this.db.transaction((rows: GoalAccountLink[]) => {
      this.db.prepare("DELETE FROM goal_account_links WHERE goal_id=?").run(goalId);
      const at = new Date().toISOString();
      for (const l of rows) {
        insert.run({ goal: goalId, acc: l.accountId, mode: l.mode, amount: l.mode === "entire" ? null : (l.amountCents ?? 0), at });
      }
    });
    tx(links);
  }

  upsertWishlistItem(w: WishlistItem): void {
    this.db.prepare(`INSERT INTO wishlist_items (id, name, cost_cents, kind, target_date, priority, planning_category)
      VALUES (@id,@name,@cost,@kind,@date,@priority,@cat)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, cost_cents=excluded.cost_cents, kind=excluded.kind,
        target_date=excluded.target_date, priority=excluded.priority, planning_category=excluded.planning_category`)
      .run({ id: w.id, name: w.name, cost: w.costCents, kind: w.kind, date: w.targetDate, priority: w.priority, cat: w.planningCategory });
  }
  listWishlistItems(): WishlistItem[] {
    return this.db.prepare("SELECT * FROM wishlist_items ORDER BY priority, id").all().map((r: any) => ({
      id: r.id, name: r.name, costCents: r.cost_cents, kind: r.kind, targetDate: r.target_date,
      priority: r.priority, planningCategory: r.planning_category }));
  }
  deleteWishlistItem(id: string): void { this.db.prepare("DELETE FROM wishlist_items WHERE id=?").run(id); }

  // The Wish List's order, set by dragging: position 1 at the top.
  // One transaction, and every id must be a stored item, so a stale screen
  // cannot half-apply an order.
  reorderWishlist(ids: string[]): void {
    const tx = this.db.transaction(() => {
      const set = this.db.prepare("UPDATE wishlist_items SET priority=? WHERE id=?");
      ids.forEach((id, i) => {
        if (set.run(i + 1, id).changes !== 1) throw new Error(`No Wish List item ${id}.`);
      });
    });
    tx();
  }

  // Every balance write also records that day's reading (0026), in the same
  // transaction, so the net worth chart's last point is always the headline.
  // A second write the same day replaces that day's reading.
  upsertAccountBalances(rows: AccountBalance[], recordedOn: string = localDateIso()): void {
    const stmt = this.db.prepare(`INSERT INTO account_balances (account_id, balance_cents, as_of)
      VALUES (@acc,@bal,@asof) ON CONFLICT(account_id) DO UPDATE SET balance_cents=excluded.balance_cents, as_of=excluded.as_of`);
    const reading = this.db.prepare(`INSERT INTO account_balance_readings (account_id, recorded_on, balance_cents, as_of)
      VALUES (@acc,@day,@bal,@asof) ON CONFLICT(account_id, recorded_on) DO UPDATE SET balance_cents=excluded.balance_cents, as_of=excluded.as_of`);
    const tx = this.db.transaction((rs: AccountBalance[]) => {
      for (const r of rs) {
        stmt.run({ acc: r.accountId, bal: r.balanceCents, asof: r.asOf });
        reading.run({ acc: r.accountId, day: recordedOn, bal: r.balanceCents, asof: r.asOf });
      }
    });
    tx(rows);
  }
  getAccountBalances(): AccountBalance[] {
    return this.db.prepare("SELECT * FROM account_balances").all().map((r: any) => ({
      accountId: r.account_id, balanceCents: r.balance_cents, asOf: r.as_of }));
  }
  listBalanceReadings(): BalanceReading[] {
    return this.db.prepare("SELECT * FROM account_balance_readings ORDER BY recorded_on, account_id").all().map((r: any) => ({
      accountId: r.account_id, recordedOn: r.recorded_on, balanceCents: r.balance_cents, asOf: r.as_of }));
  }

  // App-owned data-quality adjustments (migrations/0004_adjustments.sql).
  // Nullable match columns pass straight through as null/undefined-safe --
  // callers (applyAdjustments) branch on match_kind and only read the
  // columns relevant to that kind.
  getTransactionAdjustments(): TransactionAdjustment[] {
    return this.db.prepare("SELECT * FROM transaction_adjustments ORDER BY id").all().map((r: any) => ({
      matchKind: r.match_kind, sourceTransactionId: r.source_transaction_id,
      matchCategory: r.match_category, matchAmountCents: r.match_amount_cents,
      action: r.action, toCategory: r.to_category ?? null, note: r.note,
    }));
  }

  /** Returns the new row's id, so a filing can name what it wrote. */
  addTransactionAdjustment(a: TransactionAdjustment): number {
    const info = this.db.prepare(`INSERT INTO transaction_adjustments
        (match_kind, source_transaction_id, match_category, match_amount_cents, action, to_category, note)
      VALUES (@matchKind, @sourceTransactionId, @matchCategory, @matchAmountCents, @action, @toCategory, @note)`)
      .run({
        matchKind: a.matchKind, sourceTransactionId: a.sourceTransactionId ?? null,
        matchCategory: a.matchCategory ?? null, matchAmountCents: a.matchAmountCents ?? null,
        action: a.action, toCategory: a.toCategory ?? null, note: a.note ?? null,
      });
    return Number(info.lastInsertRowid);
  }

  deleteTransactionAdjustment(id: number): void {
    this.db.prepare("DELETE FROM transaction_adjustments WHERE id=?").run(id);
  }

  // -----------------------------------------------------------------------
  // Scenarios (migrations/0005_scenarios.sql). Normalized, no JSON columns:
  // income_* columns on the scenarios row hold the 'custom'/'plan'
  // income models; scenario_income_steps holds 'schedule' steps (read back
  // ordered by from_period). The built-in A/B/C scenarios were never
  // persisted here -- they lived only in src/domain/scenario.ts and were
  // retired with the Scenarios screen.
  // -----------------------------------------------------------------------

  private rowToScenario(row: any, steps: any[], deltas: any[], overrides: any[]): Scenario {
    let income: IncomeRampModel;
    if (row.income_kind === "schedule") {
      income = {
        kind: "schedule",
        steps: steps
          .slice()
          .sort((a, b) => (a.from_period < b.from_period ? -1 : a.from_period > b.from_period ? 1 : 0))
          .map((s) => ({ fromPeriod: s.from_period, netMonthlyCents: s.net_monthly_cents })),
      };
    } else if (row.income_kind === "custom") {
      income = { kind: "custom", netMonthlyCents: row.income_custom_cents, startPeriod: row.income_start_period };
    } else {
      income = { kind: "plan" };
    }
    return {
      id: row.id,
      planId: row.plan_id,
      name: row.name,
      isDefault: !!row.is_default,
      income,
      // from_period is omitted (not null) when unset: the UI deep-equals deltas
      // and a stray `fromPeriod: null` would read as a changed row.
      expenseDeltas: deltas.map((d) => ({
        planningCategory: d.planning_category,
        period: d.period === undefined ? null : d.period,
        deltaCents: d.delta_cents,
        ...(d.from_period ? { fromPeriod: d.from_period } : {}),
      })),
      lineOverrides: overrides.map((o) => ({
        planningCategory: o.planning_category,
        amountCents: o.amount_cents === null || o.amount_cents === undefined ? null : o.amount_cents,
        cut: !!o.cut,
        note: o.note ?? "",
        baseAmountCents: o.base_amount_cents === null || o.base_amount_cents === undefined ? null : o.base_amount_cents,
        updatedAt: o.updated_at,
      })),
      createdAt: row.created_at,
    };
  }

  private overridesFor(scenarioId: string): any[] {
    return this.db
      .prepare("SELECT * FROM scenario_line_overrides WHERE scenario_id=? ORDER BY planning_category")
      .all(scenarioId) as any[];
  }

  listScenarios(planId: string): Scenario[] {
    const rows = this.db.prepare("SELECT * FROM scenarios WHERE plan_id=? ORDER BY id").all(planId) as any[];
    return rows.map((row) => {
      const steps = this.db
        .prepare("SELECT * FROM scenario_income_steps WHERE scenario_id=? ORDER BY from_period")
        .all(row.id) as any[];
      const deltas = this.db.prepare("SELECT * FROM scenario_expense_deltas WHERE scenario_id=?").all(row.id) as any[];
      return this.rowToScenario(row, steps, deltas, this.overridesFor(row.id));
    });
  }

  getScenario(id: string): Scenario | null {
    const row: any = this.db.prepare("SELECT * FROM scenarios WHERE id=?").get(id);
    if (!row) return null;
    const steps = this.db
      .prepare("SELECT * FROM scenario_income_steps WHERE scenario_id=? ORDER BY from_period")
      .all(id) as any[];
    const deltas = this.db.prepare("SELECT * FROM scenario_expense_deltas WHERE scenario_id=?").all(id) as any[];
    return this.rowToScenario(row, steps, deltas, this.overridesFor(id));
  }

  // Atomic: the scenario row, its income steps (if any), and its expense
  // deltas are all replaced together in one transaction -- an upsert never
  // leaves a scenario with stale steps/deltas from a prior version.
  upsertScenario(s: Scenario): void {
    const startPeriod = s.income.kind === "custom" ? s.income.startPeriod : null;
    const customCents = s.income.kind === "custom" ? s.income.netMonthlyCents : null;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO scenarios (id, plan_id, name, is_default, income_kind, income_tier_id, income_mode, income_start_period, income_custom_cents, created_at)
        VALUES (@id, @planId, @name, @isDefault, @incomeKind, NULL, NULL, @startPeriod, @customCents, @createdAt)
        ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, name=excluded.name, is_default=excluded.is_default,
          income_kind=excluded.income_kind, income_tier_id=excluded.income_tier_id, income_mode=excluded.income_mode,
          income_start_period=excluded.income_start_period, income_custom_cents=excluded.income_custom_cents`,
        )
        .run({
          id: s.id,
          planId: s.planId,
          name: s.name,
          isDefault: s.isDefault ? 1 : 0,
          incomeKind: s.income.kind,
          startPeriod,
          customCents,
          createdAt: s.createdAt,
        });

      this.db.prepare("DELETE FROM scenario_income_steps WHERE scenario_id=?").run(s.id);
      if (s.income.kind === "schedule") {
        const insertStep = this.db.prepare(
          "INSERT INTO scenario_income_steps (scenario_id, from_period, net_monthly_cents) VALUES (?,?,?)",
        );
        for (const step of s.income.steps) insertStep.run(s.id, step.fromPeriod, step.netMonthlyCents);
      }

      this.db.prepare("DELETE FROM scenario_expense_deltas WHERE scenario_id=?").run(s.id);
      const insertDelta = this.db.prepare(
        "INSERT INTO scenario_expense_deltas (scenario_id, planning_category, period, delta_cents, from_period) VALUES (?,?,?,?,?)",
      );
      for (const delta of s.expenseDeltas)
        insertDelta.run(s.id, delta.planningCategory, delta.period, delta.deltaCents, delta.fromPeriod ?? null);

      this.writeOverrides(s.id, s.lineOverrides ?? []);
    });
    tx();
  }

  // Empty rows (no amount, not cut, no note) are dropped, not stored.
  private writeOverrides(scenarioId: string, overrides: LineOverride[]): void {
    this.db.prepare("DELETE FROM scenario_line_overrides WHERE scenario_id=?").run(scenarioId);
    const insert = this.db.prepare(
      `INSERT INTO scenario_line_overrides (scenario_id, planning_category, amount_cents, cut, note, base_amount_cents, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
    );
    for (const o of overrides) {
      if (isEmptyOverride(o)) continue;
      insert.run(scenarioId, o.planningCategory, o.amountCents, o.cut ? 1 : 0, o.note, o.baseAmountCents, o.updatedAt);
    }
  }

  // Explicit child deletes: the app never enables PRAGMA foreign_keys, so
  // ON DELETE CASCADE in the migration is inert for in-process deletes --
  // delete steps/deltas before the row, atomically, rather than relying on
  // cascade (see tests/data/scenarios.test.ts's schema-level cascade test,
  // which verifies the migration SQL is correct under foreign_keys=ON).
  deleteScenario(id: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM what_if_rows WHERE scenario_id=?").run(id);
      this.db.prepare("DELETE FROM what_if_goal_picks WHERE scenario_id=?").run(id);
      this.db.prepare("DELETE FROM what_if_changes WHERE scenario_id=?").run(id);
      this.db.prepare("DELETE FROM what_if_settings WHERE scenario_id=?").run(id);
      this.db.prepare("DELETE FROM scenario_line_overrides WHERE scenario_id=?").run(id);
      this.db.prepare("DELETE FROM scenario_income_steps WHERE scenario_id=?").run(id);
      this.db.prepare("DELETE FROM scenario_expense_deltas WHERE scenario_id=?").run(id);
      this.db.prepare("DELETE FROM scenarios WHERE id=?").run(id);
    });
    tx();
  }

  // -----------------------------------------------------------------------
  // What-ifs (migrations/0021_what_if.sql, 0029_what_if_rows.sql). A what-if
  // hangs off a scenarios row: one settings row (the base salary), its changes,
  // and its one list of rows, each switched on or off. Saved as a set,
  // like the line overrides. what_if_goal_picks is no longer read or written
  // (0029 carried it into the rows).
  // -----------------------------------------------------------------------

  private readWhatIf(settings: any): WhatIf {
    const changes = this.db
      .prepare("SELECT * FROM what_if_changes WHERE scenario_id=? ORDER BY position, id")
      .all(settings.scenario_id) as any[];
    const rows = this.db
      .prepare("SELECT * FROM what_if_rows WHERE scenario_id=? ORDER BY position, kind, ref_id")
      .all(settings.scenario_id) as any[];
    // migrations/0028: a what-if's own additional salary. Omitted, not null, when it
    // uses the one in Settings, Salary, so a what-if saved before reads exactly as it did.
    const kind = settings.additional_kind ?? null;
    const additional: WhatIf["additionalSalary"] =
      kind === "none"
        ? "none"
        : kind === "w2"
          ? { kind: "w2", grossAnnualCents: settings.additional_amount_cents, fromPeriod: settings.additional_from_period }
          : kind === "monthly"
            ? { kind: "monthly", monthlyCents: settings.additional_amount_cents, fromPeriod: settings.additional_from_period }
            : null;
    return {
      scenarioId: settings.scenario_id,
      salaryGrossAnnualCents: settings.salary_gross_annual_cents ?? null,
      salaryFromPeriod: settings.salary_from_period ?? null,
      ...(additional !== null ? { additionalSalary: additional } : {}),
      changes: changes.map((c): WhatIfChange => {
        const loan: LoanInputs | null =
          c.loan_price_cents === null
            ? null
            : {
                priceCents: c.loan_price_cents,
                downPaymentCents: c.loan_down_payment_cents,
                annualRate: c.loan_annual_rate,
                years: c.loan_years,
                // Omitted, not null, on a car: the client deep-equals changes.
                ...(c.loan_property_tax_year_cents !== null ? { propertyTaxYearCents: c.loan_property_tax_year_cents } : {}),
                ...(c.loan_insurance_year_cents !== null ? { insuranceYearCents: c.loan_insurance_year_cents } : {}),
              };
        return {
          id: c.id,
          position: c.position,
          kind: c.kind,
          label: c.label,
          planningCategory: c.planning_category,
          amountCents: c.amount_cents,
          fromPeriod: c.from_period,
          untilPeriod: c.until_period ?? null,
          loan,
        };
      }),
      rows: rows.map((r): WhatIfRow => ({ kind: r.kind, refId: r.ref_id, position: r.position, on: r.is_on === 1 })),
    };
  }

  getWhatIf(scenarioId: string): WhatIf | null {
    const row = this.db.prepare("SELECT * FROM what_if_settings WHERE scenario_id=?").get(scenarioId);
    return row ? this.readWhatIf(row) : null;
  }

  listWhatIfs(planId: string): WhatIf[] {
    const rows = this.db
      .prepare(
        `SELECT w.* FROM what_if_settings w JOIN scenarios s ON s.id = w.scenario_id
         WHERE s.plan_id=? ORDER BY s.name, s.id`,
      )
      .all(planId) as any[];
    return rows.map((r) => this.readWhatIf(r));
  }

  /**
   * One step: the scenario row (income "plan", no
   * deltas) and its empty what_if_settings row, together in one transaction,
   * so a failure between the two requests the New button used to make can
   * never leave an empty scenarios row that no screen shows.
   */
  createWhatIf(planId: string, id: string, name: string, createdAt: string): WhatIf {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO scenarios (id, plan_id, name, is_default, income_kind, income_tier_id, income_mode, income_start_period, income_custom_cents, created_at)
           VALUES (?, ?, ?, 0, 'plan', NULL, NULL, NULL, NULL, ?)`,
        )
        .run(id, planId, name, createdAt);
      this.db
        .prepare("INSERT INTO what_if_settings (scenario_id, salary_gross_annual_cents, salary_from_period) VALUES (?, NULL, NULL)")
        .run(id);
    });
    tx();
    return { scenarioId: id, salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };
  }

  saveWhatIf(w: WhatIf): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO what_if_settings (scenario_id, salary_gross_annual_cents, salary_from_period, additional_kind, additional_amount_cents, additional_from_period)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(scenario_id) DO UPDATE SET salary_gross_annual_cents=excluded.salary_gross_annual_cents,
             salary_from_period=excluded.salary_from_period, additional_kind=excluded.additional_kind,
             additional_amount_cents=excluded.additional_amount_cents, additional_from_period=excluded.additional_from_period`,
        )
        .run(w.scenarioId, w.salaryGrossAnnualCents, w.salaryFromPeriod ?? null, ...additionalColumns(w.additionalSalary));
      this.db.prepare("DELETE FROM what_if_changes WHERE scenario_id=?").run(w.scenarioId);
      const insertChange = this.db.prepare(
        `INSERT INTO what_if_changes (scenario_id, id, position, kind, label, planning_category, amount_cents, from_period, until_period,
           loan_price_cents, loan_down_payment_cents, loan_annual_rate, loan_years, loan_property_tax_year_cents, loan_insurance_year_cents)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const c of w.changes) {
        insertChange.run(
          w.scenarioId, c.id, c.position, c.kind, c.label, c.planningCategory, c.amountCents, c.fromPeriod, c.untilPeriod,
          c.loan?.priceCents ?? null, c.loan?.downPaymentCents ?? null, c.loan?.annualRate ?? null, c.loan?.years ?? null,
          c.loan?.propertyTaxYearCents ?? null, c.loan?.insuranceYearCents ?? null,
        );
      }
      this.db.prepare("DELETE FROM what_if_rows WHERE scenario_id=?").run(w.scenarioId);
      const insertRow = this.db.prepare("INSERT INTO what_if_rows (scenario_id, kind, ref_id, position, is_on) VALUES (?,?,?,?,?)");
      for (const r of w.rows) insertRow.run(w.scenarioId, r.kind, r.refId, r.position, r.on ? 1 : 0);
    });
    tx();
  }

  // -----------------------------------------------------------------------
  // BUDGET_LOG state migration (migrations/0007_budget_log_state.sql).
  // App-owned, normalized -- never written by the Monarch sync. Migrates
  // BUDGET_LOG.md's locked decisions, spend trims, snapshot history, and
  // data-quality flags into first-class app data.
  // -----------------------------------------------------------------------

  private rowToBudgetNote(row: any): BudgetNote {
    return {
      id: row.id,
      planId: row.plan_id,
      kind: row.kind,
      text: row.text,
      status: row.status,
      monthlyCents: row.monthly_cents,
      createdAt: row.created_at,
    };
  }

  listBudgetNotes(planId: string): BudgetNote[] {
    const rows = this.db.prepare("SELECT * FROM budget_notes WHERE plan_id=? ORDER BY id").all(planId) as any[];
    return rows.map((row) => this.rowToBudgetNote(row));
  }

  upsertBudgetNote(n: BudgetNote): void {
    this.db
      .prepare(
        `INSERT INTO budget_notes (id, plan_id, kind, text, status, monthly_cents, created_at)
        VALUES (@id, @planId, @kind, @text, @status, @monthlyCents, @createdAt)
        ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, kind=excluded.kind, text=excluded.text,
          status=excluded.status, monthly_cents=excluded.monthly_cents`,
      )
      .run({
        id: n.id,
        planId: n.planId,
        kind: n.kind,
        text: n.text,
        status: n.status,
        monthlyCents: n.monthlyCents,
        createdAt: n.createdAt,
      });
  }

  deleteBudgetNote(id: string): void {
    this.db.prepare("DELETE FROM budget_notes WHERE id=?").run(id);
  }

  private rowToSnapshotHistory(row: any): SnapshotHistoryEntry {
    return {
      id: row.id,
      planId: row.plan_id,
      asOf: row.as_of,
      drawableCents: row.drawable_cents,
      burn3moCents: row.burn3mo_cents,
      burn12moCents: row.burn12mo_cents,
      note: row.note,
      createdAt: row.created_at,
    };
  }

  listSnapshotHistory(planId: string): SnapshotHistoryEntry[] {
    const rows = this.db.prepare("SELECT * FROM snapshot_history WHERE plan_id=? ORDER BY as_of, id").all(planId) as any[];
    return rows.map((row) => this.rowToSnapshotHistory(row));
  }

  upsertSnapshotHistory(s: SnapshotHistoryEntry): void {
    this.db
      .prepare(
        `INSERT INTO snapshot_history (id, plan_id, as_of, drawable_cents, burn3mo_cents, burn12mo_cents, note, created_at)
        VALUES (@id, @planId, @asOf, @drawableCents, @burn3moCents, @burn12moCents, @note, @createdAt)
        ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, as_of=excluded.as_of,
          drawable_cents=excluded.drawable_cents, burn3mo_cents=excluded.burn3mo_cents,
          burn12mo_cents=excluded.burn12mo_cents, note=excluded.note`,
      )
      .run({
        id: s.id,
        planId: s.planId,
        asOf: s.asOf,
        drawableCents: s.drawableCents,
        burn3moCents: s.burn3moCents,
        burn12moCents: s.burn12moCents,
        note: s.note,
        createdAt: s.createdAt,
      });
  }

  private rowToDataQualityFlag(row: any): DataQualityFlag {
    return {
      id: row.id,
      planId: row.plan_id,
      label: row.label,
      detail: row.detail,
      status: row.status,
      resolution: row.resolution,
      createdAt: row.created_at,
    };
  }

  listDataQualityFlags(planId: string): DataQualityFlag[] {
    const rows = this.db
      .prepare("SELECT * FROM data_quality_flags WHERE plan_id=? ORDER BY id")
      .all(planId) as any[];
    return rows.map((row) => this.rowToDataQualityFlag(row));
  }

  upsertDataQualityFlag(f: DataQualityFlag): void {
    this.db
      .prepare(
        `INSERT INTO data_quality_flags (id, plan_id, label, detail, status, resolution, created_at)
        VALUES (@id, @planId, @label, @detail, @status, @resolution, @createdAt)
        ON CONFLICT(id) DO UPDATE SET plan_id=excluded.plan_id, label=excluded.label, detail=excluded.detail,
          status=excluded.status, resolution=excluded.resolution`,
      )
      .run({
        id: f.id,
        planId: f.planId,
        label: f.label,
        detail: f.detail,
        status: f.status,
        resolution: f.resolution,
        createdAt: f.createdAt,
      });
  }

  deleteDataQualityFlag(id: string): void {
    this.db.prepare("DELETE FROM data_quality_flags WHERE id=?").run(id);
  }

  // -----------------------------------------------------------------------
  // Category settings (migrations/0011_category_settings.sql): recurring vs
  // non-recurring flag (auto-derived from the seed, user-overridable) and
  // the pinned flag (user hand-set the default amount; the seed must never
  // overwrite it). recurring is a nullable INTEGER (0/1/NULL) mapped to
  // boolean|null domain-side; pinned is NOT NULL, always 0/1.
  // -----------------------------------------------------------------------

  private rowToCategorySetting(row: any): CategorySetting {
    return {
      planningCategory: row.planning_category,
      recurring: row.recurring === null || row.recurring === undefined ? null : !!row.recurring,
      recurringSource: row.recurring_source ?? null,
      pinned: !!row.pinned,
    };
  }

  getCategorySettings(): CategorySetting[] {
    return this.db.prepare("SELECT * FROM category_settings ORDER BY planning_category").all()
      .map((r: any) => this.rowToCategorySetting(r));
  }

  upsertCategorySetting(s: CategorySetting): void {
    this.db.prepare(`INSERT INTO category_settings (planning_category, recurring, recurring_source, pinned)
      VALUES (@cat, @recurring, @recurringSource, @pinned)
      ON CONFLICT(planning_category) DO UPDATE SET recurring=excluded.recurring,
        recurring_source=excluded.recurring_source, pinned=excluded.pinned`)
      .run({
        cat: s.planningCategory,
        recurring: s.recurring === null ? null : s.recurring ? 1 : 0,
        recurringSource: s.recurringSource,
        pinned: s.pinned ? 1 : 0,
      });
  }

  setCategoryPinned(planningCategory: string, pinned: boolean): void {
    this.db.prepare(`INSERT INTO category_settings (planning_category, recurring, recurring_source, pinned)
      VALUES (@cat, NULL, NULL, @pinned)
      ON CONFLICT(planning_category) DO UPDATE SET pinned=excluded.pinned`)
      .run({ cat: planningCategory, pinned: pinned ? 1 : 0 });
  }

  setCategoryRecurring(planningCategory: string, recurring: boolean | null): void {
    const source = recurring === null ? "auto" : "user";
    this.db.prepare(`INSERT INTO category_settings (planning_category, recurring, recurring_source, pinned)
      VALUES (@cat, @recurring, @source, 0)
      ON CONFLICT(planning_category) DO UPDATE SET recurring=excluded.recurring, recurring_source=excluded.recurring_source`)
      .run({ cat: planningCategory, recurring: recurring === null ? null : recurring ? 1 : 0, source });
  }

  // The user's recurring choices (migrations/0024_recurring_choices.sql): one row
  // per merchant key and account; saving again replaces it.
  // per merchant key, account and the amount the choice names (0 = every charge,
  // migration 0034); saving again replaces it.
  private static rowToChoice(r: any): RecurringChoice {
    return {
      payeeKey: r.payee_key, accountId: r.account_id, choice: r.choice, cadence: r.cadence ?? null,
      amountCents: r.amount_cents ? r.amount_cents : null, label: r.label, createdAt: r.created_at,
    };
  }
  listRecurringChoices(): RecurringChoice[] {
    return this.db.prepare("SELECT * FROM recurring_choices ORDER BY created_at, payee_key, account_id, amount_cents").all().map(NodeRepository.rowToChoice);
  }
  upsertRecurringChoice(c: RecurringChoice): void {
    this.db.prepare(`INSERT INTO recurring_choices (payee_key, account_id, amount_cents, choice, cadence, label, created_at)
      VALUES (@key, @account, @amount, @choice, @cadence, @label, @created)
      ON CONFLICT(payee_key, account_id, amount_cents) DO UPDATE SET choice=excluded.choice, cadence=excluded.cadence,
        label=excluded.label, created_at=excluded.created_at`)
      .run({ key: c.payeeKey, account: c.accountId, amount: c.amountCents ?? 0, choice: c.choice, cadence: c.cadence, label: c.label, created: c.createdAt });
  }
  deleteRecurringChoice(payeeKey: string, accountId: string, amountCents: number | null = null): void {
    this.db.prepare("DELETE FROM recurring_choices WHERE payee_key=? AND account_id=? AND amount_cents=?").run(payeeKey, accountId, amountCents ?? 0);
  }
  getRecurringChoice(payeeKey: string, accountId: string, amountCents: number | null = null): RecurringChoice | null {
    const r: any = this.db.prepare("SELECT * FROM recurring_choices WHERE payee_key=? AND account_id=? AND amount_cents=?").get(payeeKey, accountId, amountCents ?? 0);
    return r ? NodeRepository.rowToChoice(r) : null;
  }

  // Notes and the categorization log (migrations/0031_notes_and_categorization_log.sql).
  listTransactionNotes(): TransactionNote[] {
    return this.db.prepare("SELECT * FROM transaction_notes ORDER BY source_transaction_id").all().map((r: any) => ({
      sourceTransactionId: r.source_transaction_id, note: r.note, updatedAt: r.updated_at }));
  }
  setTransactionNote(sourceTransactionId: string, note: string, updatedAt: string): void {
    if (note.trim() === "") {
      this.db.prepare("DELETE FROM transaction_notes WHERE source_transaction_id=?").run(sourceTransactionId);
      return;
    }
    this.db.prepare(`INSERT INTO transaction_notes (source_transaction_id, note, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(source_transaction_id) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at`)
      .run(sourceTransactionId, note, updatedAt);
  }
  /** A pending charge settled under a new id: its note follows, unless the settled row has its own. */
  moveTransactionNote(fromId: string, toId: string): boolean {
    const info = this.db.prepare(`UPDATE transaction_notes SET source_transaction_id=?
      WHERE source_transaction_id=? AND NOT EXISTS (SELECT 1 FROM transaction_notes WHERE source_transaction_id=?)`)
      .run(toId, fromId, toId);
    return info.changes > 0;
  }
  // The two per-row maaser marks (migrations/0035_maaser_marks.sql); the sync never writes them.
  listMaaserMarks(): MaaserMark[] {
    return this.db.prepare("SELECT * FROM maaser_marks ORDER BY source_transaction_id").all().map((r: any) => ({
      sourceTransactionId: r.source_transaction_id, kind: r.kind, countedCents: r.counted_cents ?? null, updatedAt: r.updated_at }));
  }
  setMaaserMark(mark: MaaserMarkInput, updatedAt: string): void {
    this.db.prepare(`INSERT INTO maaser_marks (source_transaction_id, kind, counted_cents, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(source_transaction_id) DO UPDATE SET kind=excluded.kind, counted_cents=excluded.counted_cents, updated_at=excluded.updated_at`)
      .run(mark.sourceTransactionId, mark.kind, mark.countedCents, updatedAt);
  }
  deleteMaaserMark(sourceTransactionId: string): void {
    this.db.prepare("DELETE FROM maaser_marks WHERE source_transaction_id=?").run(sourceTransactionId);
  }
  /** A pending charge settled under a new id: its mark follows, unless the settled row has its own. */
  moveMaaserMark(fromId: string, toId: string): boolean {
    const info = this.db.prepare(`UPDATE maaser_marks SET source_transaction_id=?
      WHERE source_transaction_id=? AND NOT EXISTS (SELECT 1 FROM maaser_marks WHERE source_transaction_id=?)`)
      .run(toId, fromId, toId);
    return info.changes > 0;
  }
  addCategorizationLog(e: Omit<CategorizationLogEntry, "id" | "undoneAt">): number {
    const info = this.db.prepare(`INSERT INTO categorization_log (created_at, source_transaction_id, label, from_category,
        to_category, rule_id, adjustment_id, recurring_payee_key, recurring_account_id, prior_recurring_choice_json,
        written_recurring_choice_json)
      VALUES (@createdAt, @sourceTransactionId, @label, @fromCategory, @toCategory, @ruleId, @adjustmentId,
        @recurringPayeeKey, @recurringAccountId, @prior, @written)`)
      .run({
        createdAt: e.createdAt, sourceTransactionId: e.sourceTransactionId, label: e.label,
        fromCategory: e.fromCategory, toCategory: e.toCategory, ruleId: e.ruleId, adjustmentId: e.adjustmentId,
        recurringPayeeKey: e.recurringPayeeKey, recurringAccountId: e.recurringAccountId,
        prior: e.priorRecurringChoice ? JSON.stringify(e.priorRecurringChoice) : null,
        written: e.writtenRecurringChoice ? JSON.stringify(e.writtenRecurringChoice) : null,
      });
    return Number(info.lastInsertRowid);
  }
  getCategorizationLog(id: number): CategorizationLogEntry | null {
    const r = this.db.prepare("SELECT * FROM categorization_log WHERE id=?").get(id);
    return r ? logRow(r) : null;
  }
  listCategorizationLog(sinceIso: string): CategorizationLogEntry[] {
    return this.db.prepare("SELECT * FROM categorization_log WHERE created_at >= ? ORDER BY created_at DESC, id DESC")
      .all(sinceIso).map(logRow);
  }
  markCategorizationUndone(id: number, at: string): void {
    this.db.prepare("UPDATE categorization_log SET undone_at=? WHERE id=? AND undone_at IS NULL").run(at, id);
  }
  /** Runs `fn` inside one SQLite transaction: every write in it lands, or none does. */
  inTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // Merchants (migrations/0030_merchant_renames.sql): one rename per bank name, any
  // capital letters; saving again replaces it. Deleting is the undo.
  listMerchantRenames(): MerchantRename[] {
    return this.db.prepare("SELECT * FROM merchant_renames ORDER BY source_key").all().map((r: any) => ({
      sourceName: r.source_name, displayName: r.display_name, createdAt: r.created_at }));
  }
  upsertMerchantRename(r: MerchantRename): void {
    this.db.prepare(`INSERT INTO merchant_renames (source_key, source_name, display_name, created_at)
      VALUES (@key, @source, @display, @created)
      ON CONFLICT(source_key) DO UPDATE SET source_name=excluded.source_name, display_name=excluded.display_name,
        created_at=excluded.created_at`)
      .run({ key: r.sourceName.trim().toLowerCase(), source: r.sourceName, display: r.displayName, created: r.createdAt });
  }
  deleteMerchantRename(sourceName: string): void {
    this.db.prepare("DELETE FROM merchant_renames WHERE source_key=?").run(sourceName.trim().toLowerCase());
  }
  // A dismissed suggestion stays dismissed: a second dismissal of the same pair keeps the first.
  listSuggestionDismissals(): SuggestionDismissal[] {
    return this.db.prepare("SELECT * FROM merchant_suggestion_dismissals ORDER BY created_at, id").all().map((r: any) => ({
      id: r.id, kind: r.kind, fromName: r.from_name, intoName: r.into_name, createdAt: r.created_at }));
  }
  addSuggestionDismissal(d: SuggestionDismissal): void {
    this.db.prepare(`INSERT OR IGNORE INTO merchant_suggestion_dismissals (id, kind, from_name, into_name, created_at)
      VALUES (@id, @kind, @from, @into, @created)`)
      .run({ id: d.id, kind: d.kind, from: d.fromName, into: d.intoName, created: d.createdAt });
  }
  deleteSuggestionDismissal(id: string): void {
    this.db.prepare("DELETE FROM merchant_suggestion_dismissals WHERE id=?").run(id);
  }
}
