import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeRepository } from "../../src/data/repo.node";
import { claimSetupToken, runSimpleFinSync } from "../../server/services/simplefinService";

const DEMO = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/simplefin-demo-v2.json", import.meta.url)), "utf8")
);

const ACCESS_URL = "https://user:pass@bridge.example/simplefin";
const NOW = Date.parse("2026-09-02T12:00:00.000Z");

/** A fetch stub that records the URLs it was asked for. */
function stubFetch(responses: unknown[] | ((url: string) => unknown), status = 200) {
  const calls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    inits.push(init);
    const body = typeof responses === "function" ? responses(url) : responses[Math.min(calls.length - 1, responses.length - 1)];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    } as unknown as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls, inits };
}

function repoWithState(state: Partial<{ accessUrl: string; lastSyncedAt: string; earliestBackfilled: string }> = {}) {
  const repo = new NodeRepository(":memory:");
  repo.setSimpleFinState({
    accessUrl: state.accessUrl ?? ACCESS_URL,
    lastSyncedAt: state.lastSyncedAt ?? null,
    earliestBackfilled: state.earliestBackfilled ?? "2026-08-01",
    lastErrors: [],
  });
  return repo;
}

describe("claimSetupToken", () => {
  it("base64-decodes the setup token and POSTs it to get an access url", async () => {
    const token = Buffer.from("https://bridge.example/simplefin/claim/ABC123").toString("base64");
    const { fn, calls } = stubFetch([ACCESS_URL]);
    const url = await claimSetupToken(token, fn);
    expect(calls).toEqual(["https://bridge.example/simplefin/claim/ABC123"]);
    expect(url).toBe(ACCESS_URL);
  });

  it("explains that a setup token is single-use when the claim is refused", async () => {
    // The Bridge returns 403 for a token that was already claimed -- the most
    // likely real failure, and useless as a bare "403".
    const token = Buffer.from("https://bridge.example/simplefin/claim/ABC123").toString("base64");
    const { fn } = stubFetch(["Forbidden"], 403);
    await expect(claimSetupToken(token, fn)).rejects.toThrow(/single use|already been claimed/i);
  });

  it("rejects a token that isn't a base64 url rather than POSTing somewhere unexpected", async () => {
    const { fn, calls } = stubFetch([ACCESS_URL]);
    await expect(claimSetupToken("not-a-token", fn)).rejects.toThrow(/setup token/i);
    expect(calls).toHaveLength(0);
  });
});

describe("runSimpleFinSync", () => {
  it("refuses to run before an access url exists instead of silently doing nothing", async () => {
    const repo = new NodeRepository(":memory:");
    const { fn } = stubFetch([DEMO]);
    await expect(runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW })).rejects.toThrow(/not connected|setup token/i);
  });

  it("always sends version=2, an explicit start-date, and asks for pending rows", async () => {
    const repo = repoWithState({ lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const { fn, calls } = stubFetch([DEMO]);
    await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.pathname.endsWith("/accounts")).toBe(true);
    expect(url.searchParams.get("version")).toBe("2");
    expect(url.searchParams.get("pending")).toBe("1");
    // Without start-date the Bridge returns only since yesterday.
    expect(url.searchParams.get("start-date")).toBeTruthy();
  });

  it("sends Basic auth as a header, never as credentials inside the URL", async () => {
    // Node's fetch (undici) THROWS on a URL containing credentials:
    // "Request cannot be constructed from a URL that includes credentials".
    // SimpleFIN's access URL is exactly that shape, so the credentials have to
    // be lifted out into an Authorization header or no sync can ever run.
    // A stubbed fetch happily accepts the bad URL, which is why this needs
    // asserting explicitly rather than being caught by the other tests.
    const repo = repoWithState({ accessUrl: "https://theuser:thepass@bridge.example/simplefin", lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const { fn, calls, inits } = stubFetch([DEMO]);
    await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });

    expect(calls[0]).not.toContain("@");
    expect(calls[0]).not.toContain("thepass");
    expect(calls[0].startsWith("https://bridge.example/simplefin/accounts")).toBe(true);
    const auth = new Headers(inits[0]?.headers).get("authorization");
    expect(auth).toBe(`Basic ${Buffer.from("theuser:thepass").toString("base64")}`);
  });

  it("still works when the access url carries no credentials", async () => {
    const repo = repoWithState({ accessUrl: "https://bridge.example/simplefin", lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const { fn, inits } = stubFetch([DEMO]);
    await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });
    expect(new Headers(inits[0]?.headers).get("authorization")).toBeNull();
  });

  it("persists accounts, transactions and holdings from the feed", async () => {
    const repo = repoWithState({ lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const { fn } = stubFetch([DEMO]);
    const summary = await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });

    expect(repo.getAccounts()).toHaveLength(3);
    expect(repo.getTransactions()).toHaveLength(8);
    expect(repo.getHoldings()).toHaveLength(1);
    expect(summary.inserted).toBe(8);
    // The raw memo survives the whole trip -- feed to database.
    expect(repo.getTransactions()[0].memo).toBe("JOHNS FISHIN SHACK BAIT");
    // And the balance snapshot lands on the account...
    expect(repo.getAccounts()[0].balanceCents).toBe(11524551);
    expect(repo.getAccounts()[0].balanceDate).toBe("2026-09-03");
    // ...and in the balance table the head and the Runway panel actually read.
    // Once only the account row was written, so the head kept showing old
    // balances after the feed had moved on.
    expect(repo.getAccountBalances()).toContainEqual({
      accountId: repo.getAccounts()[0].id,
      balanceCents: 11524551,
      asOf: "2026-09-03",
    });
  });

  it("tags rows as simplefin so older imported history stays distinguishable", async () => {
    const repo = repoWithState({ lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const { fn } = stubFetch([DEMO]);
    await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });
    expect(repo.getTransactionSource("simplefin:Demo Savings:1788336000")).toBe("simplefin");
  });

  it("records the sync time and how far back the backfill reached", async () => {
    const repo = repoWithState({ lastSyncedAt: null, earliestBackfilled: null });
    const { fn } = stubFetch([DEMO]);
    await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });
    const state = repo.getSimpleFinState()!;
    expect(state.lastSyncedAt).toBe(new Date(NOW).toISOString());
    expect(state.earliestBackfilled).toBeTruthy();
  });

  it("imports the accounts that succeeded even when one account fails", async () => {
    // act.failed is a transient per-account bank error. Discarding the whole
    // response over one bad account would make a single flaky institution
    // block every other account's data.
    const repo = repoWithState({ lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const { fn } = stubFetch([{ ...DEMO, errlist: [{ code: "act.failed", msg: "bank timeout", account_id: "Demo Checking" }] }]);
    const summary = await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });
    expect(repo.getAccounts()).toHaveLength(3);
    expect(summary.errors[0].code).toBe("act.failed");
    expect(repo.getSimpleFinState()!.lastErrors[0].code).toBe("act.failed");
  });

  it("treats a dead access url (gen.auth) as needing reconnection and does NOT advance the sync clock", async () => {
    // If credentials are dead, nothing was fetched -- advancing lastSyncedAt
    // would permanently skip the window we failed to read.
    const repo = repoWithState({ lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const { fn } = stubFetch([{ errlist: [{ code: "gen.auth", msg: "access revoked" }], accounts: [] }]);
    const summary = await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });
    expect(summary.needsReconnect).toBe(true);
    expect(repo.getSimpleFinState()!.lastSyncedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("one bank needing a sign-in (con.auth) is a named warning: the others import and the clock moves", async () => {
    // One connection's con.auth must not freeze Synced or fail every Sync click
    // while every other bank is still importing.
    const repo = repoWithState({ lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const { fn } = stubFetch([
      {
        ...DEMO,
        connections: [
          ...DEMO.connections,
          { conn_id: "CON-RIDGELINE", name: "Ridgeline Example Investments", org_id: "o", sfin_url: "https://x" },
        ],
        errlist: [{ code: "con.auth", msg: "Connection to Ridgeline Example Investments may need attention. Auth required", conn_id: "CON-RIDGELINE" }],
      },
    ]);
    const summary = await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });
    expect(summary.needsReconnect).toBe(false);
    expect(summary.signInNeeded).toEqual(["Ridgeline Example Investments"]);
    expect(repo.getTransactions()).toHaveLength(8);
    expect(repo.getSimpleFinState()!.lastSyncedAt).toBe(new Date(NOW).toISOString());
    expect(repo.getSimpleFinState()!.lastErrors[0].connectionName).toBe("Ridgeline Example Investments");
  });

  it("does NOT advance the clock when no account came back at all, even without a dead access url", async () => {
    // Every connection asking for a sign-in means nothing was read; moving the
    // clock would skip that window for every bank.
    const repo = repoWithState({ lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const { fn } = stubFetch([{ errlist: [{ code: "con.auth", msg: "reauthorize" }], accounts: [] }]);
    const summary = await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });
    expect(summary.needsReconnect).toBe(false);
    expect(summary.signInNeeded).toEqual(["A bank connection"]);
    expect(repo.getSimpleFinState()!.lastSyncedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("reports the range-capped warning without treating it as a failure", async () => {
    const repo = repoWithState({ lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const { fn } = stubFetch([
      { ...DEMO, errlist: [{ code: "gen.api", msg: "Requested date range exceeds limit of 90 days and was capped." }] },
    ]);
    const summary = await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });
    expect(summary.needsReconnect).toBe(false);
    expect(repo.getTransactions()).toHaveLength(8);
  });

  it("walks a long gap in several windows and merges the results", async () => {
    const repo = repoWithState({ lastSyncedAt: "2026-01-01T00:00:00.000Z", earliestBackfilled: "2026-01-01" });
    const { fn, calls } = stubFetch(() => DEMO);
    await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });
    expect(calls.length).toBeGreaterThan(1);
    // The same 8 demo rows come back in every window; upserting by id must not
    // multiply them.
    expect(repo.getTransactions()).toHaveLength(8);
  });

  it("retires a pending row once a posted row with a different id settles it", async () => {
    // Some banks issue a NEW id when a pending charge posts. The in-place
    // upsert (keyed by id) never sees the pending row again, so without this
    // the purchase is counted twice for as long as the pending row lives.
    const repo = repoWithState({ lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const account = DEMO.accounts[0];
    const pendingTxn = { ...account.transactions[0], id: "pend-1", pending: true };
    const first = { ...DEMO, accounts: [{ ...account, transactions: [pendingTxn] }] };
    const { fn: fetch1 } = stubFetch([first]);
    await runSimpleFinSync(repo, { fetchFn: fetch1, now: () => NOW });
    expect(repo.getPendingTransactions("simplefin")).toHaveLength(1);

    // Same amount, same account, two days later, brand-new id, no longer pending.
    const settled = { ...pendingTxn, id: "post-1", pending: false, posted: pendingTxn.posted + 2 * 86400 };
    const second = { ...DEMO, accounts: [{ ...account, transactions: [settled] }] };
    const { fn: fetch2 } = stubFetch([second]);
    const summary = await runSimpleFinSync(repo, { fetchFn: fetch2, now: () => NOW });

    expect(summary.retiredPending).toBe(1);
    expect(repo.getPendingTransactions("simplefin")).toHaveLength(0);
    expect(repo.getTransactions().map((t) => t.sourceTransactionId)).toEqual([
      `simplefin:${account.id}:post-1`,
    ]);
  });

  it("moves a note from a pending row to the row that settled it", async () => {
    const repo = repoWithState({ lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const account = DEMO.accounts[0];
    const pendingTxn = { ...account.transactions[0], id: "pend-1", pending: true };
    const { fn: fetch1 } = stubFetch([{ ...DEMO, accounts: [{ ...account, transactions: [pendingTxn] }] }]);
    await runSimpleFinSync(repo, { fetchFn: fetch1, now: () => NOW });
    repo.setTransactionNote(`simplefin:${account.id}:pend-1`, "Hotel deposit", "2026-09-02T00:00:00.000Z");

    const settled = { ...pendingTxn, id: "post-1", pending: false, posted: pendingTxn.posted + 2 * 86400 };
    const { fn: fetch2 } = stubFetch([{ ...DEMO, accounts: [{ ...account, transactions: [settled] }] }]);
    await runSimpleFinSync(repo, { fetchFn: fetch2, now: () => NOW });

    expect(repo.listTransactionNotes().map((n) => [n.sourceTransactionId, n.note])).toEqual([
      [`simplefin:${account.id}:post-1`, "Hotel deposit"],
    ]);
  });

  it("does not retire a pending row that settles in place under the same id", async () => {
    const repo = repoWithState({ lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const account = DEMO.accounts[0];
    const pendingTxn = { ...account.transactions[0], pending: true };
    const { fn: fetch1 } = stubFetch([{ ...DEMO, accounts: [{ ...account, transactions: [pendingTxn] }] }]);
    await runSimpleFinSync(repo, { fetchFn: fetch1, now: () => NOW });

    const { fn: fetch2 } = stubFetch([{ ...DEMO, accounts: [{ ...account, transactions: [{ ...pendingTxn, pending: false }] }] }]);
    const summary = await runSimpleFinSync(repo, { fetchFn: fetch2, now: () => NOW });
    expect(summary.retiredPending).toBe(0);
    expect(repo.getTransactions()).toHaveLength(1);
    expect(repo.getTransactions()[0].pending).toBe(false);
  });

  it("does not overwrite an account type the user has set", async () => {
    const repo = repoWithState({ lastSyncedAt: "2026-09-01T00:00:00.000Z" });
    const { fn } = stubFetch(() => DEMO);
    await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });
    repo.setAccountType("simplefin:CON-SIMPLEFIN-DEMO:Demo Savings", "brokerage");

    await runSimpleFinSync(repo, { fetchFn: fn, now: () => NOW });
    const savings = repo.getAccounts().find((a) => a.id === "simplefin:CON-SIMPLEFIN-DEMO:Demo Savings")!;
    expect(savings.type).toBe("brokerage");
    expect(savings.typeSource).toBe("user");
  });
});
