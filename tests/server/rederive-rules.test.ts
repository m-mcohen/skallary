// tests/server/rederive-rules.test.ts
// Rebuilding learned rules removes old suggestions, recomputes them from
// the fixture history, and preserves manually entered rules.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NormalizedTxn } from "../../src/domain/types";
import { demoAccounts } from "../demo";

let server: Server;
let baseUrl: string;
let repo: any;

const account = demoAccounts()[0];

// One merchant always has the same category. The other is evenly split.
const txns: NormalizedTxn[] = [
  ...Array.from({ length: 4 }, (_, i) => ({
    sourceTransactionId: `target-${i}`, accountId: account.id, date: "2027-01-05", amountCents: -2_000,
    sourceCategory: "Groceries", merchant: "Target", isTransfer: false, sourceUpdatedAt: null,
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    sourceTransactionId: `walmart-${i}`, accountId: account.id, date: "2027-01-06", amountCents: -3_000,
    sourceCategory: i % 2 === 0 ? "Shopping" : "Groceries", merchant: "Walmart", isTransfer: false, sourceUpdatedAt: null,
  })),
];

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-rederive-"));
  const { openRepo } = await import("../../server/db/openDb.js");
  const { buildApp } = await import("../../server/app.js");
  repo = openRepo();
  repo.upsertAccounts([account]);
  repo.upsertTransactions(txns, "monarch");
  await new Promise<void>((resolve) => { server = buildApp().listen(0, "127.0.0.1", () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const post = async (path: string) =>
  (await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();

describe("POST /api/rules/rederive", () => {
  test("replaces learned rules and drops ones the current logic would refuse", async () => {
    // Seed learned rules that the current history cannot support.
    repo.addCategorizationRules([
      { priority: 500, payeeContains: "ab", action: "categorize", toCategory: "Supplies", note: "Learned from 4 transactions" },
      { priority: 500, payeeContains: "walmart", action: "categorize", toCategory: "Shopping", note: "Learned from 6 transactions" },
    ]);

    const result = await post("/api/rules/rederive");
    const after = repo.getCategorizationRules();
    const payees = after.map((r: any) => r.payeeContains);

    expect(payees).not.toContain("ab");
    expect(payees).not.toContain("walmart");
    expect(payees).toContain("target");
    expect(result.removed).toBe(2);
  });

  test("never destroys a hand-written rule", async () => {
    // A manually entered rule keeps both its memo and amount conditions.
    repo.addCategorizationRules([
      { priority: 100, memoContains: "supply order", amountCents: -5_000, action: "categorize", toCategory: "Office supplies", note: "Manual rule" },
    ]);
    await post("/api/rules/rederive");
    const kept = repo.getCategorizationRules().filter((r: any) => r.note === "Manual rule");
    expect(kept).toHaveLength(1);
    expect(kept[0].toCategory).toBe("Office supplies");
  });
});
