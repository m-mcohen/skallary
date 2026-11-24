// server/services/simplefinService.ts
//
// The SimpleFIN Bridge connector: claim a setup token once, then pull
// /accounts on a schedule. Plain HTTPS + JSON, so unlike the Monarch connector
// it needs no Python and no shell-out.
//
// All parsing and mapping lives in src/domain/simplefin.ts (pure, tested
// against a live-captured payload); this file owns only the I/O and the
// repository writes.
import type { NodeRepository } from "../../src/data/repo.node.js";
import {
  mapSimpleFinResponse,
  planFetchWindows,
  settledPairs,
  signInNeeded,
  type MappedError,
  type SimpleFinResponse,
} from "../../src/domain/simplefin.js";

export interface SimpleFinDeps {
  /** Injected so the sync is testable without network access. */
  fetchFn: typeof fetch;
  /** Injected so window planning and the sync clock are deterministic in tests. */
  now: () => number;
}

export interface SyncSummary {
  inserted: number;
  updated: number;
  accounts: number;
  holdings: number;
  errors: MappedError[];
  /** True when credentials are dead and the user must paste a fresh setup token. */
  needsReconnect: boolean;
  /** Bank connections that need a fresh sign-in on the Bridge; the rest still imported. */
  signInNeeded: string[];
  /** Rows the feed sent that we could not use (e.g. no usable date). */
  skipped: number;
  /** Pending rows retired because a posted row settled them under a new id. */
  retiredPending: number;
}

/**
 * Splits an access URL of the form https://user:pass@host/path into a
 * credential-free URL plus a Basic auth header value.
 *
 * Required, not cosmetic: Node's fetch throws outright on a URL containing
 * credentials, so passing SimpleFIN's access URL through verbatim means no
 * sync can ever run. A stubbed fetch in tests accepts it happily, which is
 * why this is asserted explicitly.
 */
export function splitAccessUrl(accessUrl: string): { requestBase: string; authHeader: string | null } {
  const url = new URL(accessUrl);
  if (!url.username && !url.password) return { requestBase: accessUrl, authHeader: null };
  const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  url.username = "";
  url.password = "";
  // Strip the trailing slash URL normalization adds, so the caller's
  // `${base}/accounts` join stays correct.
  const requestBase = url.toString().replace(/\/$/, "");
  return { requestBase, authHeader: `Basic ${Buffer.from(credentials).toString("base64")}` };
}

/**
 * The access url itself is dead: nothing was fetched and only a new setup
 * token helps. con.auth is deliberately NOT here -- that is one bank asking
 * for a fresh sign-in on the Bridge while every other connection still
 * imports (see signInNeeded).
 */
function isAccessDead(code: string): boolean {
  return code === "gen.auth";
}

/**
 * Exchange a one-time setup token for a durable access URL.
 *
 * The token is a base64-encoded claim URL. It is SINGLE USE: claiming twice
 * returns 403, which is by far the most common real failure (start a connect,
 * navigate away, retry), so it gets an explanation rather than a bare status.
 */
export async function claimSetupToken(setupToken: string, fetchFn: typeof fetch): Promise<string> {
  let claimUrl: string;
  try {
    claimUrl = Buffer.from(setupToken.trim(), "base64").toString("utf8");
  } catch {
    throw new Error("That doesn't look like a SimpleFIN setup token.");
  }
  if (!/^https:\/\/\S+$/.test(claimUrl)) {
    throw new Error("That doesn't look like a SimpleFIN setup token: it should decode to an https claim URL.");
  }

  const res = await fetchFn(claimUrl, { method: "POST" });
  if (res.status === 403) {
    throw new Error(
      "SimpleFIN refused this setup token. Setup tokens are single use -- if this one was already claimed, generate a fresh one on the Bridge and try again."
    );
  }
  if (!res.ok) {
    throw new Error(`SimpleFIN claim failed (HTTP ${res.status}).`);
  }
  const accessUrl = (await res.text()).trim();
  if (!/^https:\/\//.test(accessUrl)) {
    throw new Error("SimpleFIN returned something that isn't an access URL.");
  }
  return accessUrl;
}

/**
 * Pull the feed and write it into the database.
 *
 * Never throws on a per-account failure: a transient `act.failed` at one
 * institution must not discard the accounts that did come back.
 */
export async function runSimpleFinSync(repo: NodeRepository, deps: SimpleFinDeps): Promise<SyncSummary> {
  const state = repo.getSimpleFinState();
  if (!state?.accessUrl) {
    throw new Error("Not connected to SimpleFIN yet -- paste a setup token from the Bridge first.");
  }

  const nowMs = deps.now();
  const windows = planFetchWindows({
    now: Math.floor(nowMs / 1000),
    lastSyncedAt: state.lastSyncedAt,
    earliestBackfilled: state.earliestBackfilled,
  });

  const summary: SyncSummary = {
    inserted: 0, updated: 0, accounts: 0, holdings: 0, errors: [], needsReconnect: false, signInNeeded: [],
    skipped: 0, retiredPending: 0,
  };
  const seenAccounts = new Set<string>();
  let earliestRequested: number | null = null;

  // SimpleFIN hands back an access URL with the credentials embedded
  // (https://user:pass@host/simplefin). Node's fetch REFUSES such a URL --
  // "Request cannot be constructed from a URL that includes credentials" --
  // so the credentials are lifted out here and sent as a Basic auth header
  // instead, and the request URL is rebuilt without them.
  const { requestBase, authHeader } = splitAccessUrl(state.accessUrl);

  for (const window of windows) {
    const url = new URL(`${requestBase.replace(/\/$/, "")}/accounts`);
    url.searchParams.set("version", "2");
    // Without an explicit start-date the Bridge returns only transactions since
    // yesterday -- verified live against the demo endpoint.
    url.searchParams.set("start-date", String(window.startDate));
    url.searchParams.set("end-date", String(window.endDate));
    // Pending rows settle into the same transaction id, so taking them early
    // costs nothing and shows spending sooner.
    url.searchParams.set("pending", "1");

    const res = await deps.fetchFn(url.toString(), authHeader ? { headers: { Authorization: authHeader } } : undefined);
    if (res.status === 403) {
      summary.needsReconnect = true;
      summary.errors.push({ code: "gen.auth", message: "SimpleFIN access was revoked or expired.", accountId: null, connectionId: null });
      break;
    }
    if (!res.ok) {
      summary.errors.push({ code: "gen.api", message: `HTTP ${res.status} from SimpleFIN.`, accountId: null, connectionId: null });
      continue;
    }

    const payload = (await res.json()) as SimpleFinResponse;
    const mapped = mapSimpleFinResponse(payload);

    summary.errors.push(...mapped.errors);
    if (mapped.errors.some((e) => isAccessDead(e.code))) summary.needsReconnect = true;

    for (const account of mapped.accounts) {
      // Deliberately upserts the account on every window: name/institution stay
      // fresh, while type/owner/include stay user-owned (see repo.upsertAccounts).
      repo.upsertAccounts([account]);
      repo.setAccountBalance(account.id, {
        balanceCents: account.balanceCents,
        availableBalanceCents: account.availableBalanceCents,
        balanceDate: account.balanceDate,
      });
      // The same figure into the balance table drawableLiquidCents reads.
      // Two stores for one balance is how the head showed week-old numbers;
      // until they are unified, the feed writes both.
      repo.upsertAccountBalances([{ accountId: account.id, balanceCents: account.balanceCents, asOf: account.balanceDate }]);
      seenAccounts.add(account.id);
    }

    if (mapped.transactions.length > 0) {
      const result = repo.upsertTransactions(mapped.transactions, "simplefin");
      summary.inserted += result.inserted;
      summary.updated += result.updated;

      // A pending row that settles under the SAME id was just updated in
      // place above. One that settles under a NEW id was not, and would stay
      // in the ledger as a second copy of the purchase -- so the outstanding
      // pending rows are checked against this window's posted rows and the
      // settled ones retired. Retiring only sets is_deleted, so a mistaken
      // match is one UPDATE to undo -- and the upsert never clears the flag,
      // so a bank that keeps reporting the hold cannot bring it back.
      const posted = mapped.transactions.filter((t) => !t.pending);
      if (posted.length > 0) {
        const pairs = settledPairs(repo.getPendingTransactions("simplefin"), posted);
        if (pairs.length > 0) {
          // The user's note follows the charge to its settled row,
          // unless the settled row already carries one. Before retiring, so nothing is lost.
          for (const p of pairs) repo.moveTransactionNote(p.pendingId, p.postedId);
          for (const p of pairs) repo.moveMaaserMark(p.pendingId, p.postedId);
          summary.retiredPending += repo.retireTransactions(pairs.map((p) => p.pendingId));
        }
      }
    }
    summary.skipped += mapped.skipped.length;

    // Positions are a snapshot: group by account and replace each set whole.
    const byAccount = new Map<string, typeof mapped.holdings>();
    for (const holding of mapped.holdings) {
      const list = byAccount.get(holding.accountId) ?? [];
      list.push(holding);
      byAccount.set(holding.accountId, list);
    }
    for (const [accountId, holdings] of byAccount) {
      repo.replaceHoldings(accountId, holdings);
      summary.holdings += holdings.length;
    }

    earliestRequested = earliestRequested === null ? window.startDate : Math.min(earliestRequested, window.startDate);
  }

  summary.accounts = seenAccounts.size;
  summary.signInNeeded = signInNeeded(summary.errors);

  // A dead access url, or no account back at all, means nothing was read.
  // Advancing the clock would permanently skip the window we failed to fetch,
  // so leave it where it was. One bank needing a sign-in while others came
  // back is not that: the clock moves, and that bank's own gap is the cost.
  const nothingRead = summary.needsReconnect || seenAccounts.size === 0;
  repo.setSimpleFinState({
    accessUrl: state.accessUrl,
    lastSyncedAt: nothingRead ? state.lastSyncedAt : new Date(nowMs).toISOString(),
    earliestBackfilled:
      earliestRequested !== null && !nothingRead
        ? new Date(earliestRequested * 1000).toISOString().slice(0, 10)
        : state.earliestBackfilled,
    lastErrors: summary.errors,
  });

  return summary;
}
