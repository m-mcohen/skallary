// src/domain/simplefin.ts
//
// Pure mapping layer for the SimpleFIN Bridge feed. No I/O -- the server's
// simplefinSync service does the HTTP and hands the parsed JSON in here.
//
// See tests/fixtures/simplefin-demo-v2.json (the public demo payload).
import type { Cents } from "./money";
import type { Account, NormalizedTxn } from "./types";

/**
 * SimpleFIN sends every monetary value as a "numeric string" -- the protocol
 * allows different numbers of decimal places, such as a market value of "1200.5"
 * or a purchase price of "10.00".
 *
 * String parsing avoids losing a cent to floating-point rounding. More than two decimals rounds to the nearest cent, away
 * from zero on an exact tie.
 */
export function parseAmountToCents(input: string): Cents {
  const s = input.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Not a numeric amount: ${JSON.stringify(input)}`);
  }
  const negative = s.startsWith("-");
  const [whole, frac = ""] = s.replace(/^[+-]/, "").split(".");
  // Three fractional digits: two of cents plus one to round on.
  const digits = (frac + "000").slice(0, 3);
  let cents = Number(whole) * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) cents += 1;
  return negative ? -cents : cents;
}

// ---------------------------------------------------------------------------
// Wire types -- the shape the Bridge actually returns (version=2).
// ---------------------------------------------------------------------------

export interface SimpleFinTransaction {
  id: string;
  posted: number;
  amount: string;
  description: string;
  payee?: string;
  memo?: string;
  transacted_at?: number;
  pending?: boolean;
  mcc?: string;
  extra?: Record<string, unknown>;
}

export interface SimpleFinHolding {
  id: string;
  created?: number;
  cost_basis?: string;
  currency?: string;
  description?: string;
  market_value?: string;
  purchase_price?: string;
  shares?: string;
  symbol?: string;
}

export interface SimpleFinAccount {
  id: string;
  name: string;
  currency: string;
  balance: string;
  "available-balance"?: string;
  "balance-date": number;
  transactions?: SimpleFinTransaction[];
  holdings?: SimpleFinHolding[];
  conn_id?: string;
  extra?: Record<string, unknown>;
}

export interface SimpleFinConnection {
  conn_id: string;
  name: string;
  org_id: string;
  org_name?: string;
  org_url?: string;
  sfin_url: string;
}

export interface SimpleFinError {
  code?: string;
  msg?: string;
  account_id?: string;
  conn_id?: string;
}

export interface SimpleFinResponse {
  errlist?: SimpleFinError[];
  accounts: SimpleFinAccount[];
  connections?: SimpleFinConnection[];
  "x-api-message"?: string[];
}

// ---------------------------------------------------------------------------
// Mapped output
// ---------------------------------------------------------------------------

/** An Account plus the balance snapshot the feed reports alongside it. */
export interface MappedAccount extends Account {
  balanceCents: Cents;
  availableBalanceCents: Cents;
  /** YYYY-MM-DD (UTC) the balance was taken -- shown in the Sync UI so
   *  "last refreshed" is honest about the Bridge's once-a-day cadence. */
  balanceDate: string;
}

export interface MappedHolding {
  accountId: string;
  symbol: string | null;
  description: string | null;
  /** Kept as the feed's string: share counts are not money and not cents. */
  shares: string | null;
  costBasisCents: Cents | null;
  marketValueCents: Cents | null;
  purchasePriceCents: Cents | null;
  currency: string | null;
}

export interface MappedError {
  code: string;
  message: string;
  accountId: string | null;
  connectionId: string | null;
  /** The bank connection's own name. Optional: older saved warnings lack it. */
  connectionName?: string | null;
}

export interface SkippedTransaction {
  accountId: string;
  transactionId: string;
  reason: string;
}

export interface MappedSimpleFin {
  accounts: MappedAccount[];
  transactions: NormalizedTxn[];
  holdings: MappedHolding[];
  errors: MappedError[];
  skipped: SkippedTransaction[];
}

/**
 * Dates are extracted in UTC, deliberately. The feed gives epoch seconds, so
 * local-time extraction would make the same database produce different months
 * (and therefore different budgets) on machines in different timezones. The
 * cost is that a transaction stamped late-evening UTC lands on the next local
 * day; determinism is worth more here than that edge.
 */
function utcDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/** Account ids are only unique WITHIN a connection, so the id carries both. */
export function simplefinAccountId(connId: string | undefined, accountId: string): string {
  return `simplefin:${connId ?? "unknown"}:${accountId}`;
}

/** Transaction ids are only unique within an account, so the id carries both. */
export function simplefinTransactionId(accountId: string, transactionId: string): string {
  return `simplefin:${accountId}:${transactionId}`;
}

function optionalCents(value: string | undefined): Cents | null {
  return value === undefined ? null : parseAmountToCents(value);
}

export function mapSimpleFinResponse(response: SimpleFinResponse): MappedSimpleFin {
  const connections = new Map((response.connections ?? []).map((c) => [c.conn_id, c]));

  const accounts: MappedAccount[] = [];
  const transactions: NormalizedTxn[] = [];
  const holdings: MappedHolding[] = [];
  const skipped: SkippedTransaction[] = [];

  for (const account of response.accounts) {
    const id = simplefinAccountId(account.conn_id, account.id);
    const connection = account.conn_id ? connections.get(account.conn_id) : undefined;

    accounts.push({
      id,
      name: account.name,
      // SimpleFIN has no type/subtype field. The user types accounts once in the
      // app; sync must never overwrite that with null (see repo.upsertAccounts).
      type: null,
      institution: connection ? connection.org_name ?? connection.name : null,
      currency: account.currency,
      isOwned: true,
      includeInSpend: true,
      owner: "me",
      balanceCents: parseAmountToCents(account.balance),
      availableBalanceCents: parseAmountToCents(account["available-balance"] ?? account.balance),
      balanceDate: utcDate(account["balance-date"]),
    });

    for (const txn of account.transactions ?? []) {
      // `posted` is 0 until a pending transaction settles; `transacted_at` is
      // when it actually happened. Prefer posted -- it's the date that moves
      // the balance, so it reconciles against statements.
      const stamp = txn.posted > 0 ? txn.posted : txn.transacted_at;
      if (!stamp) {
        skipped.push({ accountId: id, transactionId: txn.id, reason: "no usable date" });
        continue;
      }
      transactions.push({
        sourceTransactionId: simplefinTransactionId(account.id, txn.id),
        accountId: id,
        date: utcDate(stamp),
        // The feed's sign convention already matches ours: negative is money out.
        amountCents: parseAmountToCents(txn.amount),
        // SimpleFIN supplies no category. The rules engine owns categorization,
        // and pair-matching -- not the feed -- decides what is a transfer.
        sourceCategory: null,
        merchant: txn.payee ?? txn.description ?? null,
        isTransfer: false,
        sourceUpdatedAt: null,
        description: txn.description ?? null,
        memo: txn.memo ?? null,
        payee: txn.payee ?? null,
        mcc: txn.mcc ?? null,
        pending: txn.pending === true,
      });
    }

    for (const holding of account.holdings ?? []) {
      holdings.push({
        accountId: id,
        symbol: holding.symbol ?? null,
        description: holding.description ?? null,
        shares: holding.shares ?? null,
        costBasisCents: optionalCents(holding.cost_basis),
        marketValueCents: optionalCents(holding.market_value),
        purchasePriceCents: optionalCents(holding.purchase_price),
        currency: holding.currency ?? null,
      });
    }
  }

  const errors: MappedError[] = (response.errlist ?? []).map((e) => ({
    code: e.code ?? "gen.unknown",
    message: e.msg ?? "",
    accountId: e.account_id ?? null,
    connectionId: e.conn_id ?? null,
    connectionName: e.conn_id ? connections.get(e.conn_id)?.name ?? null : null,
  }));

  return { accounts, transactions, holdings, errors, skipped };
}

// ---------------------------------------------------------------------------
// One connection needing a sign-in
// ---------------------------------------------------------------------------

/**
 * The bank connections the Bridge says need a fresh sign-in (con.auth), each
 * named once. This is NOT a dead access url (gen.auth or HTTP 403): the other
 * connections still import, so the fix is signing in to that one bank on the
 * Bridge's website, not a new setup token. The two used to be one
 * flag, so one bank's lapse failed every sync.
 */
export function signInNeeded(errors: Pick<MappedError, "code" | "message" | "connectionName">[]): string[] {
  const names: string[] = [];
  for (const e of errors) {
    if (e.code !== "con.auth") continue;
    // Warnings saved before connectionName existed: the Bridge's own wording
    // carries the name ("Connection to Example Bank may need attention").
    const name = e.connectionName ?? /Connection to (.+?) may need attention/.exec(e.message)?.[1] ?? "A bank connection";
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Pending -> posted settlement
// ---------------------------------------------------------------------------

/**
 * Days a posted row may sit from the pending row it settles. Same tolerance
 * as transfer pair-matching: a weekend, without making unrelated equal
 * amounts look like the same purchase.
 */
export const SETTLE_WINDOW_DAYS = 3;

const DAY_MS = 86_400_000;

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
}

/**
 * Words the bank wraps around a merchant name that say nothing about who was
 * paid. "PENDING PURCHASE" and "POS DEBIT CARD" share every one of these
 * without being the same purchase.
 */
const MEMO_BOILERPLATE = new Set([
  "pending", "purchase", "pos", "debit", "credit", "card", "payment", "transaction",
  "authorized", "auth", "visa", "mastercard", "the", "and",
]);

/**
 * The tokens that identify WHO a row paid: lowercase alphanumeric runs from
 * payee/merchant/description, three characters or longer, boilerplate removed.
 * Empty when the row carries no usable text.
 */
function identityTokens(t: NormalizedTxn): Set<string> {
  const text = [t.payee, t.merchant, t.description].filter(Boolean).join(" ").toLowerCase();
  const out = new Set<string>();
  for (const tok of text.split(/[^a-z0-9]+/)) {
    if (tok.length >= 3 && !MEMO_BOILERPLATE.has(tok)) out.add(tok);
  }
  return out;
}

/**
 * Whether two rows could be the same purchase by name. A $5 coffee posted on
 * Monday must not settle a $5 transit fare pending on Tuesday, so when both
 * rows name a merchant they have to share at least one token. When either
 * side has nothing usable (no memo, or boilerplate only) there is nothing to
 * compare and amount + date carry the match alone.
 */
function sameIdentity(a: NormalizedTxn, b: NormalizedTxn): boolean {
  const ta = identityTokens(a);
  if (ta.size === 0) return true;
  const tb = identityTokens(b);
  if (tb.size === 0) return true;
  for (const tok of ta) if (tb.has(tok)) return true;
  return false;
}

/**
 * Pending rows a posted row has settled UNDER A DIFFERENT ID.
 *
 * The upsert handles the common case for free: a pending row that settles
 * under the same id updates in place. But some institutions mint a fresh id
 * when the charge posts, and then the pending row never gets touched again --
 * the purchase is in the ledger twice for as long as the pending row lives.
 *
 * A match is the same account, the same amount, a different id, dates
 * within SETTLE_WINDOW_DAYS, and -- when both rows name a merchant -- a shared
 * identity token (see sameIdentity). Each pending row is matched once, to the
 * closest-dated posted row; each posted row settles at most one pending row,
 * so two identical pending coffees and one posted settle retire only one.
 *
 * Returns each retired pending row with the posted row that settled it, so
 * the user's note can follow the charge.
 */
export function settledPairs(pendingRows: NormalizedTxn[], postedRows: NormalizedTxn[]): { pendingId: string; postedId: string }[] {
  const posted = postedRows.filter((t) => t.pending !== true);
  const consumed = new Set<string>();
  const retired: { pendingId: string; postedId: string }[] = [];

  // Closest pairs are claimed first, so a posted row goes to the pending row
  // it most plausibly settles rather than to whichever came first in the list.
  const candidates: { pendingId: string; postedId: string; distance: number }[] = [];
  for (const p of pendingRows) {
    for (const s of posted) {
      if (s.sourceTransactionId === p.sourceTransactionId) continue;
      if (s.accountId !== p.accountId || s.amountCents !== p.amountCents) continue;
      const distance = daysApart(p.date, s.date);
      if (distance > SETTLE_WINDOW_DAYS) continue;
      if (!sameIdentity(p, s)) continue;
      candidates.push({ pendingId: p.sourceTransactionId, postedId: s.sourceTransactionId, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);

  const matchedPending = new Set<string>();
  for (const c of candidates) {
    if (matchedPending.has(c.pendingId) || consumed.has(c.postedId)) continue;
    matchedPending.add(c.pendingId);
    consumed.add(c.postedId);
    retired.push({ pendingId: c.pendingId, postedId: c.postedId });
  }
  return retired;
}

// ---------------------------------------------------------------------------
// Sync on launch
// ---------------------------------------------------------------------------

/**
 * How old the last sync may be before opening the app triggers a fresh one.
 * The Bridge refreshes about once a day, so anything under half a day is
 * already as current as the feed can be; syncing on every launch would only
 * burn the ~24-calls-a-day budget that disables the token.
 */
export const AUTO_SYNC_STALE_HOURS = 12;

/**
 * Whether launch should kick off a sync. Never when the connector isn't set
 * up (there is nothing to sync and the error would greet every launch);
 * always when connected but never synced.
 */
export function autoSyncDue(
  state: { accessUrl: string | null; lastSyncedAt: string | null },
  nowMs: number,
  staleHours: number = AUTO_SYNC_STALE_HOURS
): boolean {
  if (!state.accessUrl) return false;
  if (!state.lastSyncedAt) return true;
  const last = Date.parse(state.lastSyncedAt);
  if (Number.isNaN(last)) return true;
  return nowMs - last > staleHours * 3_600_000;
}

// ---------------------------------------------------------------------------
// Fetch planning
// ---------------------------------------------------------------------------

/**
 * Days per /accounts request.
 *
 * The published protocol says 90, but the LIVE Bridge answers a 90-day request
 * with "Requested date range exceeds recommended range of 45 days. In the
 * future, this may be capped." It still returns the data today, so this is a
 * forward-compatibility fix, not a bug fix -- but a silently capped window
 * would mean quietly missing transactions, which is the worst failure this
 * connector has.
 */
export const MAX_WINDOW_DAYS = 45;

/**
 * Days of overlap re-fetched before the last sync point. The Bridge filters on
 * the transaction date, and a pending row's date moves when it settles, so
 * resuming at exactly lastSyncedAt silently drops rows. Upserts are keyed by
 * transaction id, so re-sending costs nothing but a little bandwidth.
 */
export const OVERLAP_DAYS = 5;

/** How far back a first-ever sync tries to reach. Most institutions expose 1-2 years. */
export const BACKFILL_MONTHS = 24;

/**
 * Hard ceiling on requests per sync. The Bridge expects ~24 /accounts calls a
 * day and DISABLES the access token past its warning threshold, so the backfill
 * is capped rather than allowed to walk back arbitrarily far.
 */
export const MAX_WINDOWS_PER_SYNC = 12;

const DAY = 86400;

export interface FetchWindow {
  /** Unix epoch seconds, inclusive -- passed as the `start-date` parameter. */
  startDate: number;
  /** Unix epoch seconds, exclusive -- passed as `end-date`. */
  endDate: number;
}

export interface FetchPlanInput {
  /** Unix epoch seconds. */
  now: number;
  /** ISO instant of the last successful sync, or null if never synced. */
  lastSyncedAt: string | null;
  /** YYYY-MM-DD the backfill walker has already reached, or null. */
  earliestBackfilled: string | null;
}

/**
 * Windows to request, oldest first, contiguous, each within the 90-day cap.
 *
 * An explicit start-date is ALWAYS sent: verified live, a request without one
 * returns only transactions since yesterday, with the response carrying
 * "Provide a 'start-date' parameter to receive transactions prior to yesterday".
 */
export function planFetchWindows(input: FetchPlanInput): FetchWindow[] {
  const { now, lastSyncedAt, earliestBackfilled } = input;

  // Where the fetch needs to begin: an overlap before the last sync, or the
  // full backfill horizon on a first run.
  const from = lastSyncedAt
    ? Math.floor(Date.parse(lastSyncedAt) / 1000) - OVERLAP_DAYS * DAY
    : now - BACKFILL_MONTHS * 30 * DAY;

  // Never re-request history a previous backfill already walked.
  const floor = earliestBackfilled ? Math.floor(Date.parse(`${earliestBackfilled}T00:00:00.000Z`) / 1000) : null;
  const bounded = floor !== null ? Math.max(from, floor - OVERLAP_DAYS * DAY) : from;

  // The walk goes oldest-first and stops at MAX_WINDOWS_PER_SYNC, so a start
  // further back than the cap can cover means the walk RUNS OUT before
  // reaching today. That is not theoretical: BACKFILL_MONTHS asks for 720 days
  // while the cap reaches 540, so a first sync requested the oldest stretch and
  // never asked for the most recent 180 days -- a fresh install fetched
  // nothing at all. Recent history is the part that matters, so the start is
  // pulled forward to whatever the cap can actually walk to now.
  const reach = MAX_WINDOWS_PER_SYNC * MAX_WINDOW_DAYS * DAY;
  const start = Math.max(bounded, now - reach);

  const windows: FetchWindow[] = [];
  for (let cursor = start; cursor < now && windows.length < MAX_WINDOWS_PER_SYNC; cursor += MAX_WINDOW_DAYS * DAY) {
    windows.push({ startDate: cursor, endDate: Math.min(cursor + MAX_WINDOW_DAYS * DAY, now + DAY) });
  }
  return windows;
}
