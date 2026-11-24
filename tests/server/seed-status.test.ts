// tests/server/seed-status.test.ts
// Seed date + re-seed due: the seed stamps last_seed_at, and
// GET/POST /api/settings/seed expose it. Temp-DB harness as in
// tests/server/mutations.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeRepository } from "../../src/data/repo.node.js";
import type { NormalizedTxn } from "../../src/domain/types.js";

let server: Server;
let baseUrl: string;
let repo: NodeRepository;
let seedBudgetService: typeof import("../../server/services/seedBudgetService.js");

interface SeedStatus {
  lastSeedAt: string | null;
  windowMonths: number | null;
  reseedDueAt: string | null;
  reseedDue: boolean;
}

const get = async (path: string) => (await fetch(`${baseUrl}${path}`)).json();
const post = (path: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-seed-status-"));
  const { buildApp } = await import("../../server/app.js");
  const { openRepo } = await import("../../server/db/openDb.js");
  repo = openRepo();
  seedBudgetService = await import("../../server/services/seedBudgetService.js");

  repo.createPlan({ id: "plan-1", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" });
  const txns: NormalizedTxn[] = [
    { sourceTransactionId: "s-1", accountId: "acc-1", date: "2026-06-05", amountCents: -5_000, sourceCategory: "Groceries", merchant: "Target", isTransfer: false, sourceUpdatedAt: null },
    { sourceTransactionId: "s-2", accountId: "acc-1", date: "2026-07-05", amountCents: -5_000, sourceCategory: "Groceries", merchant: "Target", isTransfer: false, sourceUpdatedAt: null },
    { sourceTransactionId: "s-3", accountId: "acc-1", date: "2026-08-05", amountCents: -5_000, sourceCategory: "Groceries", merchant: "Target", isTransfer: false, sourceUpdatedAt: null },
  ];
  repo.upsertTransactions(txns);

  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("GET /api/settings/seed", () => {
  test("reports never seeded, and therefore due, on a fresh database", async () => {
    const status = (await get("/api/settings/seed")) as SeedStatus;
    expect(status).toEqual({ lastSeedAt: null, windowMonths: null, reseedDueAt: null, reseedDue: true });
  });
});

describe("seedBudgetService.run stamps the seed", () => {
  test("does not stamp a seed that wrote nothing", () => {
    // A window with no actuals in it (here, a clock from before the data)
    // writes zero lines. Stamping it would start the 90-day re-seed clock
    // and record a window the budget was never actually built from.
    const result = seedBudgetService.run("plan-1", 3, () => new Date("2026-03-01T00:00:00.000Z"));
    expect(result.seededCategories).toBe(0);
    expect(repo.getSetting("last_seed_at")).toBeNull();
    expect(repo.getSetting("last_seed_window_months")).toBeNull();
  });

  test("writes last_seed_at and last_seed_window_months after a successful seed", () => {
    const now = () => new Date("2026-09-02T18:07:00.000Z");
    const result = seedBudgetService.run("plan-1", 3, now);
    expect(result.window).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(result.seededCategories).toBe(1);
    expect(repo.getSetting("last_seed_at")).toBe("2026-09-02T18:07:00.000Z");
    expect(repo.getSetting("last_seed_window_months")).toBe("3");
  });

  test("GET reflects the stamp with the due date 90 days out", async () => {
    const status = (await get("/api/settings/seed")) as SeedStatus;
    expect(status.lastSeedAt).toBe("2026-09-02T18:07:00.000Z");
    expect(status.windowMonths).toBe(3);
    expect(status.reseedDueAt).toBe("2026-12-01");
    // The route reads the real clock, so only consistency is asserted here;
    // the exact boundary is covered in tests/domain/reseed.test.ts.
    expect(status.reseedDue).toBe(new Date().toISOString().slice(0, 10) >= "2026-12-01");
  });
});

describe("POST /api/settings/seed", () => {
  test("sets last_seed_at by hand (the backfill for a seed run before stamping existed)", async () => {
    const res = await post("/api/settings/seed", { lastSeedAt: "2026-09-02T14:07:00-04:00" });
    expect(res.status).toBe(200);
    const status = (await res.json()) as SeedStatus;
    expect(status.lastSeedAt).toBe("2026-09-02T14:07:00-04:00");
    expect(status.reseedDueAt).toBe("2026-12-01");
    expect(repo.getSetting("last_seed_at")).toBe("2026-09-02T14:07:00-04:00");
    // The window is left alone: a manual stamp says when, not how much.
    expect(status.windowMonths).toBe(3);
  });

  test("rejects a stamp that is not a date rather than storing junk", async () => {
    expect((await post("/api/settings/seed", { lastSeedAt: "yesterday-ish" })).status).toBe(400);
    expect((await post("/api/settings/seed", {})).status).toBe(400);
    expect(repo.getSetting("last_seed_at")).toBe("2026-09-02T14:07:00-04:00");
  });

  test("POST /api/plans/:id/seed-budget stamps the seed through the route too", async () => {
    const before = Date.now();
    const res = await post("/api/plans/plan-1/seed-budget", { windowMonths: 2 });
    expect(res.status).toBe(200);
    const status = (await get("/api/settings/seed")) as SeedStatus;
    const stamped = Date.parse(status.lastSeedAt!);
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
    expect(status.windowMonths).toBe(2);
  });
});
