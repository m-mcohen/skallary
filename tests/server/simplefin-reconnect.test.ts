// tests/server/simplefin-reconnect.test.ts
// A Reconnect that appears only when SimpleFIN
// access is really gone, claims a fresh setup token from the usual file, and
// keeps every account, transaction and sync date.
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeRepository } from "../../src/data/repo.node.js";
import type { Account, NormalizedTxn } from "../../src/domain/types.js";

const OLD_URL = "https://olduser:oldpass@bridge.example/simplefin";
const NEW_URL = "https://newuser:newpass@bridge.example/simplefin";
const CLAIM = "https://bridge.example/simplefin/claim/abc123";
const TOKEN = Buffer.from(CLAIM).toString("base64");
const LAST = "2026-03-22T12:00:00.000Z";

let repo: NodeRepository;
let svc: typeof import("../../server/services/connectorService.js");
let tokenFile: string;

const acct: Account = { id: "acc-1", name: "Checking", type: "depository", institution: "Pinecrest Example Bank", currency: "USD", isOwned: true, includeInSpend: true, owner: "me" };
const txn: NormalizedTxn = { sourceTransactionId: "t1", accountId: "acc-1", date: "2026-09-01", amountCents: -5000, sourceCategory: "Groceries", merchant: "Whole Foods", isTransfer: false, sourceUpdatedAt: null };

const claimStub = (status = 200, body = NEW_URL) => {
  const calls: { url: string; method?: string }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method });
    return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
};
const dead = [{ code: "gen.auth", message: "SimpleFIN access was revoked or expired.", accountId: null, connectionId: null }];
const setState = (over: Partial<{ accessUrl: string | null; lastErrors: typeof dead }> = {}) =>
  repo.setSimpleFinState({ accessUrl: OLD_URL, lastSyncedAt: LAST, earliestBackfilled: "2026-01-01", lastErrors: dead, ...over } as never);

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-sfin-reconnect-"));
  const { openRepo } = await import("../../server/db/openDb.js");
  repo = openRepo();
  repo.upsertAccounts([acct]);
  repo.upsertTransactions([txn], "simplefin");
  svc = await import("../../server/services/connectorService.js");
  tokenFile = svc.setupTokenPath();
  mkdirSync(join(tokenFile, ".."), { recursive: true });
});
beforeEach(() => {
  rmSync(tokenFile, { force: true });
});

describe("status.accessLost", () => {
  test("is false before anything is connected, and while the last sync was fine", () => {
    repo.setSimpleFinState({ accessUrl: null, lastSyncedAt: null, earliestBackfilled: null, lastErrors: [] });
    expect(svc.getStatus().accessLost).toBe(false);
    setState({ lastErrors: [] });
    expect(svc.getStatus().accessLost).toBe(false);
  });
  test("one bank needing a sign-in is not lost access", () => {
    setState({ lastErrors: [{ code: "con.auth", message: "Connection to Ridgeline Example Investments may need attention. Auth required", accountId: null, connectionId: "MBR-1" }] as never });
    expect(svc.getStatus().accessLost).toBe(false);
  });
  test("is true when the last sync found the access url dead", () => {
    setState();
    expect(svc.getStatus().accessLost).toBe(true);
  });
});

describe("reconnect", () => {
  test("swaps in the new access url and keeps the sync dates, accounts and transactions", async () => {
    setState();
    writeFileSync(tokenFile, `${TOKEN}\n`);
    const { fn, calls } = claimStub();
    expect(await svc.reconnect(fn)).toEqual({ reconnected: true });
    expect(calls).toEqual([{ url: CLAIM, method: "POST" }]);
    const state = repo.getSimpleFinState();
    expect(state?.accessUrl).toBe(NEW_URL);
    expect(state?.lastSyncedAt).toBe(LAST);
    expect(state?.earliestBackfilled).toBe("2026-01-01");
    expect(state?.lastErrors).toEqual([]);
    expect(repo.getAccounts().map((a) => a.id)).toContain("acc-1");
    expect(repo.getTransactions().some((t) => t.sourceTransactionId === "t1")).toBe(true);
    expect(svc.getStatus().accessLost).toBe(false);
  });

  test("refuses when SimpleFIN access still works, and claims nothing", async () => {
    setState({ lastErrors: [] });
    writeFileSync(tokenFile, TOKEN);
    const { fn, calls } = claimStub();
    await expect(svc.reconnect(fn)).rejects.toThrow("SimpleFIN access still works, so there is nothing to reconnect. Use Sync now.");
    expect(calls).toHaveLength(0);
    expect(repo.getSimpleFinState()?.accessUrl).toBe(OLD_URL);
  });

  test("refuses when SimpleFIN was never connected: that is what Connect is for", async () => {
    repo.setSimpleFinState({ accessUrl: null, lastSyncedAt: null, earliestBackfilled: null, lastErrors: [] });
    const { fn } = claimStub();
    await expect(svc.reconnect(fn)).rejects.toThrow("SimpleFIN is not connected yet. Use Connect.");
  });

  test("without a token file it says where to put one, and changes nothing", async () => {
    setState();
    const { fn, calls } = claimStub();
    await expect(svc.reconnect(fn)).rejects.toThrow(tokenFile);
    expect(calls).toHaveLength(0);
    expect(repo.getSimpleFinState()?.accessUrl).toBe(OLD_URL);
  });

  test("a refused token leaves the old access and every date exactly as they were", async () => {
    setState();
    writeFileSync(tokenFile, TOKEN);
    const { fn } = claimStub(403, "");
    await expect(svc.reconnect(fn)).rejects.toThrow("SimpleFIN refused this setup token");
    const state = repo.getSimpleFinState();
    expect(state?.accessUrl).toBe(OLD_URL);
    expect(state?.lastSyncedAt).toBe(LAST);
    expect(state?.lastErrors).toEqual(dead);
  });
});

describe("POST /api/simplefin/reconnect", () => {
  test("is wired to the service: a working connection gets the plain refusal as a 400", async () => {
    setState({ lastErrors: [] });
    const { buildApp } = await import("../../server/app.js");
    const server = await new Promise<import("node:http").Server>((resolve) => {
      const s = buildApp().listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const { port } = server.address() as import("node:net").AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/simplefin/reconnect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("SimpleFIN access still works, so there is nothing to reconnect. Use Sync now.");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// A sync that was already running when Reconnect
// stored the new access URL wrote its OLD url back when it finished, undoing the reconnect after the
// one-time setup token was spent. Reconnect and sync now take turns, in either order.
describe("reconnect and sync take turns", () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };
  const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => String(body) }) as unknown as Response;
  const tick = () => new Promise((r) => setTimeout(r, 25));

  test("a sync already running finishes first, so it cannot write the old url over the new one", async () => {
    setState();
    writeFileSync(tokenFile, TOKEN);
    const syncFetch = deferred<Response>();
    const syncing = svc.sync((() => syncFetch.promise) as unknown as typeof fetch);
    await tick();
    const claim = claimStub();
    const reconnecting = svc.reconnect(claim.fn);
    await tick();
    expect(claim.calls).toHaveLength(0); // waiting its turn: the token is not spent while a sync is mid-flight
    syncFetch.resolve(res(403)); // the old access is dead, as the saved error already said
    await syncing;
    expect(await reconnecting).toEqual({ reconnected: true });
    expect(claim.calls).toHaveLength(1);
    expect(repo.getSimpleFinState()?.accessUrl).toBe(NEW_URL);
  });

  test("a sync asked for while Reconnect is claiming waits, then uses the new access", async () => {
    setState();
    writeFileSync(tokenFile, TOKEN);
    const claimed = deferred<Response>();
    const claimFetch = vi.fn(() => claimed.promise) as unknown as typeof fetch;
    const reconnecting = svc.reconnect(claimFetch);
    await tick();
    const seen: { url: string; auth?: string }[] = [];
    const syncFetch = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
      return res(403);
    }) as unknown as typeof fetch;
    const syncing = svc.sync(syncFetch);
    await tick();
    expect(seen).toHaveLength(0); // not started: it would have captured the old access
    claimed.resolve({ ok: true, status: 200, text: async () => NEW_URL } as unknown as Response);
    await reconnecting;
    await syncing;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].auth).toBe(`Basic ${Buffer.from("newuser:newpass").toString("base64")}`);
  });

  test("two Reconnect presses at once claim the token once", async () => {
    setState();
    writeFileSync(tokenFile, TOKEN);
    const claim = claimStub();
    const [a, b] = await Promise.all([svc.reconnect(claim.fn), svc.reconnect(claim.fn)]);
    expect(a).toEqual({ reconnected: true });
    expect(b).toEqual({ reconnected: true });
    expect(claim.calls).toHaveLength(1);
  });
});
