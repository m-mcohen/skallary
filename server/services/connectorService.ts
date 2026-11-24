// server/services/connectorService.ts
//
// Business logic for the SimpleFIN connector endpoints: connect, sync, status,
// account typing, and the categorization rules. Routes stay thin HTTP bindings;
// the HTTP-to-SimpleFIN talking lives in simplefinService.ts and all the
// decision logic is pure code in src/domain.
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { sqliteFinanceRepository } from "../repositories/sqliteFinanceRepository.js";
import { claimSetupToken, runSimpleFinSync, type SyncSummary } from "./simplefinService.js";
import { writeSnapshot } from "./snapshotService.js";
import { autoSyncDue } from "../../src/domain/simplefin.js";
import { accountsNeedingType, guessAccountType } from "../../src/domain/runway.js";
import { SAVING_CATEGORIES } from "../../src/domain/savings.js";
import { deriveRulesFromHistory, type CategorizationRule } from "../../src/domain/rules.js";
import { prepareTransactions } from "../../src/domain/pipeline.js";
import type { Account, NormalizedTxn } from "../../src/domain/types.js";
import { currentPlan } from "../../src/domain/plan-choice.js";
import { localDateIso } from "../../src/domain/period.js";

/**
 * Where the one-time setup token is read from.
 *
 * A file rather than a request body or an environment variable: the token
 * decodes to credentials for every linked bank, so it stays on disk beside the
 * database in %LOCALAPPDATA% and never travels through a chat, a commit, or a
 * shell history.
 */
export function setupTokenPath(): string {
  const base = process.env.LOCALAPPDATA ?? process.env.HOME ?? ".";
  return join(base, "finance", "simplefin-token.txt");
}

/** Types the app understands. Anything else is rejected rather than stored. */
export const ACCOUNT_TYPES = ["depository", "credit", "brokerage", "retirement", "loan"] as const;

export interface ConnectorStatus {
  connected: boolean;
  lastSyncedAt: string | null;
  earliestBackfilled: string | null;
  lastErrors: { code: string; message: string; accountId: string | null; connectionId: string | null; connectionName?: string | null }[];
  /** Accounts still on a guessed type -- drawable can't trust their sign yet. */
  accountsNeedingType: (Account & { suggestedType: string | null })[];
  /** Where to put the setup token, so the UI can say it rather than hardcode it. */
  setupTokenPath: string;
  /**
   * The last sync found the access url itself dead (not one bank asking for a
   * sign-in), so only a fresh setup token helps. Drives the Reconnect button.
   */
  accessLost: boolean;
  /**
   * A sync is running right now, usually the start-up one. The page
   * reads this on load: while true it says "Syncing" instead of judging the banks
   * on data the sync is about to replace, then reloads once the sync is done.
   */
  syncing: boolean;
}

export function getStatus(): ConnectorStatus {
  const repo = sqliteFinanceRepository();
  const state = repo.getSimpleFinState();
  return {
    connected: !!state?.accessUrl,
    lastSyncedAt: state?.lastSyncedAt ?? null,
    earliestBackfilled: state?.earliestBackfilled ?? null,
    lastErrors: state?.lastErrors ?? [],
    accountsNeedingType: accountsNeedingType(repo.getAccounts()).map((a) => ({
      ...a,
      // A starting guess from the name, since SimpleFIN supplies no type.
      // Shown as a suggestion to confirm, never applied on its own.
      suggestedType: guessAccountType(a.name),
    })),
    setupTokenPath: setupTokenPath(),
    accessLost: !!state?.accessUrl && (state.lastErrors ?? []).some((e) => e.code === "gen.auth"),
    syncing: inFlight !== null,
  };
}

/**
 * Claim the setup token and store the resulting access URL.
 *
 * Idempotent by design: if an access URL already exists this does nothing,
 * because setup tokens are single use and a second claim would 403 and leave
 * the connector worse off than before.
 */
type ConnectResult = { connected: boolean; alreadyConnected: boolean };
let connecting: Promise<ConnectResult> | null = null;

export function connect(fetchFn: typeof fetch = fetch): Promise<ConnectResult> {
  return connecting ??= connectNow(fetchFn).finally(() => { connecting = null; });
}

async function connectNow(fetchFn: typeof fetch): Promise<ConnectResult> {
  const repo = sqliteFinanceRepository();
  const existing = repo.getSimpleFinState();
  if (existing?.accessUrl) return { connected: true, alreadyConnected: true };

  const path = setupTokenPath();
  if (!existsSync(path)) {
    throw new Error(
      `No setup token found. Generate one on the SimpleFIN Bridge and save it to ${path} (the token is credentials for every linked bank, so it stays on disk rather than being pasted anywhere).`
    );
  }
  const token = readFileSync(path, "utf8").trim();
  if (!token) throw new Error(`${path} is empty -- paste the setup token from the SimpleFIN Bridge into it.`);

  const accessUrl = await claimSetupToken(token, fetchFn);
  repo.setSimpleFinState({ accessUrl, lastSyncedAt: null, earliestBackfilled: null, lastErrors: [] });
  return { connected: true, alreadyConnected: false };
}

export async function disconnect(): Promise<void> {
  // Let any operation that can save an access URL finish before clearing it.
  let pending: Promise<unknown> | null;
  while ((pending = connecting ?? reconnecting ?? inFlight)) await pending.catch(() => undefined);

  const repo = sqliteFinanceRepository();
  repo.inTransaction(() => {
    if (!repo.getSimpleFinState()?.accessUrl) return;
    repo.setSimpleFinState({ accessUrl: null, lastSyncedAt: null, earliestBackfilled: null, lastErrors: [] });
    try {
      unlinkSync(setupTokenPath());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Skallary couldn't delete the token file. Check that you can delete it, then try again.");
      }
    }
  });
}

/**
 * Replace a dead access URL with a fresh one claimed from the usual token file,
 * keeping everything else: accounts, transactions, and both sync dates (so the
 * next sync fetches from where the dead one stopped).
 *
 * Only when access is really gone (the last sync said gen.auth). Claiming is the
 * one step that can fail, and it happens before anything is written, so a refused
 * token leaves the old state exactly as it was.
 */
async function reconnectNow(fetchFn: typeof fetch): Promise<{ reconnected: true }> {
  const repo = sqliteFinanceRepository();
  const state = repo.getSimpleFinState();
  if (!state?.accessUrl) throw new Error("SimpleFIN is not connected yet. Use Connect.");
  if (!getStatus().accessLost) throw new Error("SimpleFIN access still works, so there is nothing to reconnect. Use Sync now.");

  const path = setupTokenPath();
  if (!existsSync(path)) {
    throw new Error(
      `No setup token found. Generate a new one on the SimpleFIN Bridge and save it to ${path}, then press Reconnect. Your data is kept.`
    );
  }
  const token = readFileSync(path, "utf8").trim();
  if (!token) throw new Error(`${path} is empty -- paste the new setup token from the SimpleFIN Bridge into it.`);

  const accessUrl = await claimSetupToken(token, fetchFn);
  repo.setSimpleFinState({ accessUrl, lastSyncedAt: state.lastSyncedAt, earliestBackfilled: state.earliestBackfilled, lastErrors: [] });
  return { reconnected: true };
}

/**
 * The Reconnect currently running, if any. A sync captures the access URL when it starts and writes
 * it back when it ends, so a Reconnect that stored a new one meanwhile would be undone: the two take turns, in either order, and two presses at once claim the token once.
 */
let reconnecting: Promise<{ reconnected: true }> | null = null;

export async function reconnect(fetchFn: typeof fetch = fetch): Promise<{ reconnected: true }> {
  if (reconnecting) return reconnecting;
  // Let a sync already under way finish first. The loop re-checks, because another sync may start in
  // the gap; from the last check to setting `reconnecting` there is no await, so none can slip in.
  while (inFlight) await inFlight.catch(() => undefined);
  if (reconnecting) return reconnecting;
  reconnecting = reconnectNow(fetchFn).finally(() => {
    reconnecting = null;
  });
  return reconnecting;
}

/**
 * The sync currently running, if any. The launch auto-sync and a Sync click
 * seconds later would otherwise run two full syncs against the Bridge's
 * ~24-calls-a-day budget for the same data, so a second caller joins the
 * run in progress instead of starting its own.
 */
let inFlight: Promise<SyncSummary> | null = null;

export function sync(fetchFn: typeof fetch = fetch, now: () => number = Date.now): Promise<SyncSummary> {
  if (inFlight) return inFlight;
  // A Reconnect under way goes first, so this sync starts from the access it stores.
  const start = () => runSimpleFinSync(sqliteFinanceRepository() as never, { fetchFn, now });
  inFlight = (reconnecting ? reconnecting.then(start, start) : start())
    .then((summary) => {
      // One snapshot per sync so recorded net-worth history accumulates.
      // Best-effort: a failure here logs and lets the sync return -- a missed
      // snapshot is a hole in the chart, not a lost sync.
      try {
        const plans = sqliteFinanceRepository().listPlans();
        const pick = currentPlan(plans, localDateIso());
        if (pick) writeSnapshot(pick.id, "auto (post-sync)");
      } catch (e) {
        console.warn("post-sync snapshot failed:", e);
      }
      return summary;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * The launch-time sync: runs only when connected AND the last sync is older
 * than AUTO_SYNC_STALE_HOURS (see src/domain/simplefin.ts for why not every
 * launch). Null means "nothing to do", which the caller logs and moves on
 * from; a real sync failure still rejects, so the caller decides how loud
 * to be.
 */
export async function autoSyncIfStale(now: () => number = Date.now, fetchFn: typeof fetch = fetch): Promise<SyncSummary | null> {
  const state = sqliteFinanceRepository().getSimpleFinState();
  const due = autoSyncDue({ accessUrl: state?.accessUrl ?? null, lastSyncedAt: state?.lastSyncedAt ?? null }, now());
  if (!due) return null;
  return sync(fetchFn, now);
}

export function setAccountType(id: string, type: string): void {
  if (!(ACCOUNT_TYPES as readonly string[]).includes(type)) {
    throw new Error(`Unknown account type "${type}". Expected one of: ${ACCOUNT_TYPES.join(", ")}.`);
  }
  sqliteFinanceRepository().setAccountType(id, type);
}

export function setAccountDrawable(id: string, drawable: boolean | null): void {
  sqliteFinanceRepository().setAccountDrawable(id, drawable);
}

/**
 * Hides a superseded account record. Presentational only -- see migration
 * 0015: the row keeps its transactions and stays in every total.
 */
export function setAccountArchived(id: string, archived: boolean): void {
  sqliteFinanceRepository().setAccountArchived(id, archived);
}

/**
 * Where money put away in this account lands: 'Investing', 'Retirement', or
 * null for an ordinary spending or cash account (migration 0020). Setting it
 * makes every move INTO this account from an unflagged one count as saving,
 * and silences the account's own internal rows.
 */
/** The pot account: the one account the charity pot is set aside in. */
export function setAccountMaaserPot(id: string, on: unknown): void {
  if (typeof on !== "boolean") throw new Error("The pot account switch is either on or off.");
  sqliteFinanceRepository().setAccountMaaserPot(id, on);
}

export function setAccountSavingsDestination(id: string, destination: string | null): void {
  const clean = destination === null || destination === "" ? null : String(destination);
  if (clean !== null && !SAVING_CATEGORIES.includes(clean as (typeof SAVING_CATEGORIES)[number])) {
    throw new Error(`Unknown savings destination: ${clean}`);
  }
  sqliteFinanceRepository().setAccountSavingsDestination(id, clean);
}

// --- Categorization rules ---------------------------------------------------

export function getRules(): CategorizationRule[] {
  return sqliteFinanceRepository().getCategorizationRules();
}

export function addRule(rule: Omit<CategorizationRule, "id">): number {
  return sqliteFinanceRepository().addCategorizationRule(rule);
}

export function deleteRule(id: number): void {
  sqliteFinanceRepository().deleteCategorizationRule(id);
}

/**
 * One-time bootstrap from already-categorized history.
 *
 * The existing Monarch rows encode the user's own taxonomy; without this the
 * cutover starts from a cold categorizer and every recurring merchant lands in
 * the review queue again. Skips merchants a rule already covers so running it
 * twice doesn't pile up duplicates.
 */
export function bootstrapRules(): { created: number } {
  const repo = sqliteFinanceRepository();
  const existing = new Set(
    repo.getCategorizationRules().map((r) => (r.payeeContains ?? "").toLowerCase()).filter(Boolean)
  );
  const derived = deriveRulesFromHistory(repo.getTransactions()).filter(
    (r) => !existing.has((r.payeeContains ?? "").toLowerCase())
  );
  if (derived.length === 0) return { created: 0 };
  const created = repo.addCategorizationRules(derived.map(({ id: _id, ...rest }) => rest));
  return { created };
}

/** Marks a rule as machine-learned rather than a human decision. */
const LEARNED_NOTE = /^Learned from /;

/**
 * REPLACES every learned rule by re-running the derivation over history.
 *
 * Distinct from bootstrapRules, which only ever adds and skips merchants a
 * rule already covers -- so a bad learned rule survives every re-bootstrap.
 * That is not hypothetical: `payee="ce" -> Electronics` (learned from three
 * transactions, matching "Example WorkspaCE" and "Example InsuranCE") and
 * `payee="zelle" -> Other Income` (a plurality across many payments that are
 * really rent, gifts and business income) were both live. Whenever the
 * derivation logic is tightened, this is what retires what it used to produce.
 *
 * Hand-written rules are never touched -- they are the user's own decisions
 * and outrank anything learned.
 */
export function rederiveRules(): { removed: number; created: number } {
  const repo = sqliteFinanceRepository();
  const learned = repo.getCategorizationRules().filter((r) => LEARNED_NOTE.test(r.note ?? ""));
  for (const rule of learned) repo.deleteCategorizationRule(rule.id);
  const derived = deriveRulesFromHistory(repo.getTransactions());
  const created = derived.length
    ? repo.addCategorizationRules(derived.map(({ id: _id, ...rest }) => rest))
    : 0;
  return { removed: learned.length, created };
}

/**
 * Transactions no rule and no feed category covers -- the review queue.
 *
 * Assigning a category here creates a rule, so the app never asks about the
 * same merchant twice.
 */
export function getUncategorized(): NormalizedTxn[] {
  const repo = sqliteFinanceRepository();
  return prepareTransactions(repo.getTransactions(), {
    rules: repo.getCategorizationRules(),
    adjustments: repo.getTransactionAdjustments(),
    accounts: repo.getAccounts(),
    mapping: repo.getCategoryMappings(),
  // A row inside a savings destination, or one side of a wash, is never missing
  // a category -- it counts nowhere by design, so it must not sit in the review
  // queue asking the user to file brokerage sweep noise.
  }).filter((t) => !t.sourceCategory && !t.isTransfer && !t.isWash && !t.savingBucket);
}

// --- History seam ------------------------------------------------------------

/**
 * Clears the backfill bookmarks so the next sync re-walks SimpleFIN's whole
 * window instead of just the days since the last run.
 *
 * Needed because planFetchWindows deliberately never re-requests history a
 * previous backfill already reached -- correct for daily syncing, wrong when
 * the point is to pull the 90 days back into the database.
 */
export function resetBackfillBookmarks(days?: number): void {
  const repo = sqliteFinanceRepository();
  const state = repo.getSimpleFinState();
  if (!state?.accessUrl) throw new Error("Not connected to SimpleFIN.");
  // `days` bounds how far back the next sync walks. The Bridge disables the
  // token past ~24 calls a day, and it only holds 90 days of history anyway,
  // so re-fetching the whole reachable span burns the budget to request
  // windows that are certain to come back empty.
  const earliestBackfilled = days
    ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    : null;
  repo.setSimpleFinState({ ...state, lastSyncedAt: null, earliestBackfilled });
}
