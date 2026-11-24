// tests/server/account-archive.test.ts
// Archiving a superseded account record: it leaves the UI without leaving the
// numbers. A switch of feed can leave two rows per real account (a legacy
// one and a live SimpleFIN one), and the legacy row owns history that
// has no other home -- SimpleFIN reaches back only 90 days.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Account, NormalizedTxn } from "../../src/domain/types.js";

let server: Server;
let baseUrl: string;

const accounts: Account[] = [
  { id: "legacy-0101", name: "JOINT CHECKING (...0101)", type: "depository", institution: "Pinecrest Example Bank", currency: "USD", isOwned: true, includeInSpend: true, owner: "joint" },
  { id: "simplefin:x:0101", name: "JOINT CHECKING (0101)", type: "depository", institution: "Pinecrest Example Bank", currency: "USD", isOwned: true, includeInSpend: true, owner: "joint" },
];

const txns: NormalizedTxn[] = [
  { sourceTransactionId: "old-1", accountId: "legacy-0101", date: "2026-05-01", amountCents: -12000,
    sourceCategory: "Groceries", merchant: "Whole Foods", isTransfer: false, sourceUpdatedAt: null },
];

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-archive-"));
  const { openRepo } = await import("../../server/db/openDb.js");
  const { buildApp } = await import("../../server/app.js");
  const repo = openRepo();
  repo.upsertAccounts(accounts);
  repo.upsertTransactions(txns, "monarch");
  await new Promise<void>((resolve) => { server = buildApp().listen(0, "127.0.0.1", () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const get = async (p: string) => (await fetch(`${baseUrl}${p}`)).json();
const post = async (p: string, body: unknown) =>
  (await fetch(`${baseUrl}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

describe("archiving an account", () => {
  test("marks it archived without touching the transactions it owns", async () => {
    await post("/api/accounts/legacy-0101/archived", { archived: true });

    const manage: Account[] = await get("/api/accounts/manage");
    const legacy = manage.find((a) => a.id === "legacy-0101");
    expect(legacy?.archived).toBe(true);

    // The whole point: its history survives. Deleting the row instead would
    // orphan its transactions with nowhere else to live.
    const all: NormalizedTxn[] = await get("/api/transactions");
    expect(all.filter((t) => t.accountId === "legacy-0101")).toHaveLength(1);
  });

  test("keeps an archived account in the spending math", async () => {
    // Archived means "superseded record, don't clutter the screen", NOT
    // "exclude from calculations" -- include_in_spend already answers that
    // question and archiving must not silently change any total.
    const calcFacing: Account[] = await get("/api/accounts");
    expect(calcFacing.map((a) => a.id)).toContain("legacy-0101");
  });

  test("can be un-archived", async () => {
    await post("/api/accounts/legacy-0101/archived", { archived: false });
    const manage: Account[] = await get("/api/accounts/manage");
    expect(manage.find((a) => a.id === "legacy-0101")?.archived).toBe(false);
  });
});
