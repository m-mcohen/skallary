// tests/server/autosync.test.ts
// Sync-on-launch: connectorService.autoSyncIfStale against a temp DB (mkdtemp
// over LOCALAPPDATA, read BEFORE the server's DB singleton is first opened).
// Same harness as simplefin-api.test.ts, minus the HTTP server -- launch
// calls the service directly, so that is what is exercised here.
import { beforeAll, describe, expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NodeRepository } from "../../src/data/repo.node.js";

const DEMO = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/simplefin-demo-v2.json", import.meta.url)), "utf8")
);
const ACCESS_URL = "https://user:pass@bridge.example/simplefin";
const NOW = Date.parse("2026-09-02T12:00:00.000Z");
const HOUR = 3_600_000;

let repo: NodeRepository;
let autoSyncIfStale: typeof import("../../server/services/connectorService.js").autoSyncIfStale;
let sync: typeof import("../../server/services/connectorService.js").sync;
let getStatus: typeof import("../../server/services/connectorService.js").getStatus;

function stubFetch() {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => DEMO, text: async () => JSON.stringify(DEMO) } as unknown as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-autosync-"));
  const { openRepo } = await import("../../server/db/openDb.js");
  repo = openRepo();
  ({ autoSyncIfStale, sync, getStatus } = await import("../../server/services/connectorService.js"));
});

describe("autoSyncIfStale", () => {
  test("does nothing when the connector is not set up -- no error greets every launch", async () => {
    const { fn, calls } = stubFetch();
    expect(await autoSyncIfStale(() => NOW, fn)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("skips a sync that is fresher than the stale threshold", async () => {
    repo.setSimpleFinState({
      accessUrl: ACCESS_URL,
      lastSyncedAt: new Date(NOW - 2 * HOUR).toISOString(),
      earliestBackfilled: "2026-08-01",
      lastErrors: [],
    });
    const { fn, calls } = stubFetch();
    expect(await autoSyncIfStale(() => NOW, fn)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("runs a real sync when the last one is older than the threshold, and advances the clock", async () => {
    repo.setSimpleFinState({
      accessUrl: ACCESS_URL,
      lastSyncedAt: new Date(NOW - 20 * HOUR).toISOString(),
      earliestBackfilled: "2026-08-01",
      lastErrors: [],
    });
    const { fn, calls } = stubFetch();
    const summary = await autoSyncIfStale(() => NOW, fn);
    expect(summary).not.toBeNull();
    expect(summary!.accounts).toBe(3);
    expect(calls.length).toBeGreaterThan(0);
    expect(repo.getSimpleFinState()!.lastSyncedAt).toBe(new Date(NOW).toISOString());

    // Immediately after, launch again: now fresh, so nothing runs.
    const again = stubFetch();
    expect(await autoSyncIfStale(() => NOW + HOUR, again.fn)).toBeNull();
    expect(again.calls).toHaveLength(0);
  });
});

describe("one sync at a time", () => {
  /** A fetch that answers only once released, so two callers can overlap. */
  function gatedFetch() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const calls: string[] = [];
    const fn = vi.fn(async (url: string) => {
      calls.push(url);
      await gate;
      return { ok: true, status: 200, json: async () => DEMO, text: async () => JSON.stringify(DEMO) } as unknown as Response;
    });
    return { fn: fn as unknown as typeof fetch, calls, release };
  }

  test("a sync click during the launch auto-sync joins it instead of starting a second run", async () => {
    // Two full syncs 2s apart would spend twice against the Bridge's ~24
    // calls-a-day budget for the same data.
    repo.setSimpleFinState({
      accessUrl: ACCESS_URL,
      lastSyncedAt: new Date(NOW - 20 * HOUR).toISOString(),
      earliestBackfilled: "2026-08-01",
      lastErrors: [],
    });
    const gated = gatedFetch();
    const launch = autoSyncIfStale(() => NOW, gated.fn);
    const click = sync(gated.fn, () => NOW);
    await new Promise((r) => setTimeout(r, 10));
    const inFlightCalls = gated.calls.length;
    expect(inFlightCalls).toBeGreaterThan(0);

    gated.release();
    const [fromLaunch, fromClick] = await Promise.all([launch, click]);
    expect(fromClick).toBe(fromLaunch);
    // Nothing past what the single run fetched.
    expect(gated.calls).toHaveLength(inFlightCalls);

    // Once finished, the next request is a fresh run.
    const again = stubFetch();
    await sync(again.fn, () => NOW + HOUR);
    expect(again.calls.length).toBeGreaterThan(0);
  });

  // The page asks the status whether a sync is running, so it can say
  // "Syncing" and reload when the start-up sync ends instead of judging old data.
  test("the status says a sync is running while the start-up sync runs, and not after", async () => {
    repo.setSimpleFinState({
      accessUrl: ACCESS_URL,
      lastSyncedAt: new Date(NOW - 20 * HOUR).toISOString(),
      earliestBackfilled: "2026-08-01",
      lastErrors: [],
    });
    expect(getStatus().syncing).toBe(false);
    const gated = gatedFetch();
    const launch = autoSyncIfStale(() => NOW, gated.fn);
    await new Promise((r) => setTimeout(r, 10));
    expect(getStatus().syncing).toBe(true);
    gated.release();
    await launch;
    expect(getStatus().syncing).toBe(false);
  });

  test("a failed run clears the slot so the next click can retry", async () => {
    // A network-level failure (the Bridge unreachable) is the one that
    // rejects; an HTTP error is recorded in the summary instead.
    const failing = vi.fn(async () => { throw new Error("connect ECONNREFUSED"); }) as unknown as typeof fetch;
    await expect(sync(failing, () => NOW)).rejects.toThrow(/ECONNREFUSED/);
    const { fn, calls } = stubFetch();
    await sync(fn, () => NOW);
    expect(calls.length).toBeGreaterThan(0);
  });
});
