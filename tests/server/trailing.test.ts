// tests/server/trailing.test.ts
// Trailing N-month spend: the service with an injected clock for exact
// numbers, and the route for shape. Temp-DB harness as in
// tests/server/mutations.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeRepository } from "../../src/data/repo.node.js";
import type { Account, NormalizedTxn } from "../../src/domain/types.js";

let server: Server;
let baseUrl: string;
let repo: NodeRepository;
let trailingService: typeof import("../../server/services/trailingService.js");

interface Trailing {
  months: number;
  window: string[];
  totalCents: number;
  monthlyAverageCents: number;
}

const NOW = () => new Date("2026-09-02T18:00:00.000Z");

const accounts: Account[] = [
  { id: "acc-a", name: "Checking", type: "depository", institution: "Bank", currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  { id: "acc-b", name: "Savings", type: "depository", institution: "Bank", currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  { id: "acc-x", name: "Excluded", type: "depository", institution: "Bank", currency: "USD", isOwned: true, includeInSpend: false, owner: "me" },
];

const base = { sourceCategory: null, merchant: null, isTransfer: false, sourceUpdatedAt: null };
const txns: NormalizedTxn[] = [
  // In the 3-month window (2026-06..08): 100 + 200 + 300 = 600.00 of groceries.
  { ...base, sourceTransactionId: "g-06", accountId: "acc-a", date: "2026-06-10", amountCents: -10000, sourceCategory: "Groceries" },
  { ...base, sourceTransactionId: "g-07", accountId: "acc-a", date: "2026-07-10", amountCents: -20000, sourceCategory: "Groceries" },
  { ...base, sourceTransactionId: "g-08", accountId: "acc-a", date: "2026-08-10", amountCents: -30000, sourceCategory: "Groceries" },
  // Outside a 3-month window, inside a 12-month one.
  { ...base, sourceTransactionId: "g-05", accountId: "acc-a", date: "2026-05-10", amountCents: -55555, sourceCategory: "Groceries" },
  // The current, partial month: never counted.
  { ...base, sourceTransactionId: "g-09", accountId: "acc-a", date: "2026-09-01", amountCents: -99999, sourceCategory: "Groceries" },
  // Income is not spend.
  { ...base, sourceTransactionId: "pay", accountId: "acc-a", date: "2026-07-01", amountCents: 500000, sourceCategory: "Salary" },
  // A transfer pair between two tracked accounts: neither leg is spend.
  { ...base, sourceTransactionId: "xfer-out", accountId: "acc-a", date: "2026-07-15", amountCents: -40000 },
  { ...base, sourceTransactionId: "xfer-in", accountId: "acc-b", date: "2026-07-16", amountCents: 40000 },
  // An account switched off in Accounts: not spend.
  { ...base, sourceTransactionId: "off", accountId: "acc-x", date: "2026-08-01", amountCents: -77777, sourceCategory: "Dining" },
  // Uncategorized by the feed; a rule names it -- and it is counted (12.34 in 08).
  { ...base, sourceTransactionId: "sub", accountId: "acc-a", date: "2026-08-20", amountCents: -1234, payee: "Netflix" },
  // Junk row the user excluded via an adjustment: not spend.
  { ...base, sourceTransactionId: "junk", accountId: "acc-a", date: "2026-08-21", amountCents: -88888, sourceCategory: "Dining" },
];

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-trailing-"));
  const { buildApp } = await import("../../server/app.js");
  const { openRepo } = await import("../../server/db/openDb.js");
  repo = openRepo();
  trailingService = await import("../../server/services/trailingService.js");

  repo.createPlan({ id: "plan-1", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" });
  repo.upsertAccounts(accounts);
  repo.upsertTransactions(txns);
  repo.setCategoryMapping("Salary", "Income");
  repo.addCategorizationRule({ priority: 10, payeeContains: "netflix", action: "categorize", toCategory: "Subscriptions" });
  repo.addTransactionAdjustment({ matchKind: "id", sourceTransactionId: "junk", action: "exclude" });

  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("trailingService.trailingSpend", () => {
  test("averages expense over the N complete months before the current one, prepared exactly like the seed", () => {
    const result = trailingService.trailingSpend(3, NOW);
    expect(result.window).toEqual(["2026-06", "2026-07", "2026-08"]);
    // 600.00 groceries + 12.34 Netflix; income, both transfer legs, the
    // excluded account and the excluded junk row all stay out.
    expect(result.totalCents).toBe(60000 + 1234);
    expect(result.monthlyAverageCents).toBe(Math.round(61234 / 3));
    expect(result.months).toBe(3);
  });

  test("defaults to twelve months and divides by the whole window, not just the months with data", () => {
    const result = trailingService.trailingSpend(undefined, NOW);
    expect(result.months).toBe(12);
    expect(result.window[0]).toBe("2025-09");
    expect(result.window[11]).toBe("2026-08");
    expect(result.totalCents).toBe(61234 + 55555);
    expect(result.monthlyAverageCents).toBe(Math.round((61234 + 55555) / 12));
  });

  // The window ended a month late on the last evening of a month, because it
  // read the UTC month. The Dashboard reads the local calendar everywhere else (the chart's average
  // month at Day 31 must equal this tile), and at 8:30 p.m. on Sep 30 in New York September is not over.
  test("ends with the month before the LOCAL month, on both sides of midnight", () => {
    expect(trailingService.trailingSpend(3, () => new Date(2026, 8, 30, 23, 59)).window).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(trailingService.trailingSpend(3, () => new Date(2026, 9, 1, 0, 1)).window).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  test("rejects a nonsensical month count", () => {
    expect(() => trailingService.trailingSpend(0, NOW)).toThrow(/months/i);
    expect(() => trailingService.trailingSpend(2.5, NOW)).toThrow(/months/i);
  });
});

describe("GET /api/trailing", () => {
  test("returns the contract shape for the real clock", async () => {
    const res = await fetch(`${baseUrl}/api/trailing?months=3`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Trailing;
    expect(body.months).toBe(3);
    expect(body.window).toHaveLength(3);
    // The window ends the month BEFORE the current one.
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prev = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}`;
    expect(body.window[2]).toBe(prev);
    expect(typeof body.totalCents).toBe("number");
    expect(typeof body.monthlyAverageCents).toBe("number");
    expect(body.monthlyAverageCents).toBeGreaterThanOrEqual(0);
  });

  test("the old plan-scoped path is gone -- actuals are shared across plans", async () => {
    expect((await fetch(`${baseUrl}/api/plans/plan-1/trailing?months=3`)).status).toBe(404);
  });

  test("defaults to 12 months and refuses a bad count", async () => {
    const body = (await (await fetch(`${baseUrl}/api/trailing`)).json()) as Trailing;
    expect(body.months).toBe(12);
    expect(body.window).toHaveLength(12);
    expect((await fetch(`${baseUrl}/api/trailing?months=-4`)).status).toBe(400);
  });
});
