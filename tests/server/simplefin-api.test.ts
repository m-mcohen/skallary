// tests/server/simplefin-api.test.ts
// Route -> service -> repository -> SQLite for the SimpleFIN connector
// endpoints. Runs against a temp DB by pointing LOCALAPPDATA at a mkdtemp dir
// before the server's DB singleton is first opened.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Account, NormalizedTxn } from "../../src/domain/types.js";

let server: Server;
let baseUrl: string;

const accounts: Account[] = [
  { id: "acc-checking", name: "Test Checking", type: "depository", institution: "Pinecrest Example Bank", currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  { id: "acc-mystery", name: "Account 0707", type: null, institution: "Pinecrest Example Bank", currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
];

const txns: NormalizedTxn[] = [
  { sourceTransactionId: "t-known", accountId: "acc-checking", date: "2026-08-01", amountCents: -5000,
    sourceCategory: "Groceries", merchant: "Whole Foods", isTransfer: false, sourceUpdatedAt: null },
  { sourceTransactionId: "t-known2", accountId: "acc-checking", date: "2026-08-02", amountCents: -6000,
    sourceCategory: "Groceries", merchant: "Whole Foods", isTransfer: false, sourceUpdatedAt: null },
  { sourceTransactionId: "t-blank", accountId: "acc-checking", date: "2026-09-01", amountCents: -3500,
    sourceCategory: null, merchant: null, isTransfer: false, sourceUpdatedAt: null,
    memo: "ZELLE TO SAM EXAMPLE", payee: null, description: "Zelle payment", mcc: null, pending: false },
];

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-sfin-api-"));
  const { openRepo } = await import("../../server/db/openDb.js");
  const { buildApp } = await import("../../server/app.js");
  const repo = openRepo();
  repo.upsertAccounts(accounts);
  repo.upsertTransactions(txns, "monarch");

  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const get = async (path: string) => (await fetch(`${baseUrl}${path}`)).json();
const post = async (path: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

describe("GET /api/simplefin/status", () => {
  test("reports not connected, and which accounts still need typing", async () => {
    const status = await get("/api/simplefin/status");
    expect(status.connected).toBe(false);
    expect(status.lastSyncedAt).toBeNull();
    // acc-checking carries a real feed-supplied type and is trusted;
    // acc-mystery has none, so drawable can't trust its sign yet.
    expect(status.accountsNeedingType.map((a: Account) => a.id)).toEqual(["acc-mystery"]);
  });
});

describe("POST /api/accounts/:id/type", () => {
  test("sets the type and marks it user-owned so no sync can overwrite it", async () => {
    const res = await post("/api/accounts/acc-mystery/type", { type: "credit" });
    expect(res.status).toBe(204);
    const manage = await get("/api/accounts/manage");
    const mystery = manage.find((a: Account) => a.id === "acc-mystery");
    expect(mystery.type).toBe("credit");
    expect(mystery.typeSource).toBe("user");

    const status = await get("/api/simplefin/status");
    expect(status.accountsNeedingType).toEqual([]);
  });

  test("rejects a type that isn't one we understand rather than storing junk", async () => {
    const res = await post("/api/accounts/acc-mystery/type", { type: "banana" });
    expect(res.status).toBe(400);
  });
});

describe("categorization rules", () => {
  test("adds a rule and applies it to an uncategorized transaction", async () => {
    const before = await get("/api/transactions/uncategorized");
    expect(before.map((t: NormalizedTxn) => t.sourceTransactionId)).toEqual(["t-blank"]);

    const res = await post("/api/rules", {
      priority: 100, memoContains: "example", amountMinCents: -4000, amountMaxCents: -3000,
      action: "categorize", toCategory: "Internet",
    });
    expect(res.status).toBe(200);

    // Once a rule covers it, it leaves the review queue -- assigning a
    // category creates a rule, so the app never asks about it twice.
    expect(await get("/api/transactions/uncategorized")).toEqual([]);
  });

  test("lists rules in priority order", async () => {
    const rules = await get("/api/rules");
    expect(rules).toHaveLength(1);
    expect(rules[0].toCategory).toBe("Internet");
  });

  test("bootstraps rules from already-categorized history", async () => {
    const res = await post("/api/rules/bootstrap");
    const body = await res.json();
    // Whole Foods appears twice under Groceries in the seeded history.
    expect(body.created).toBe(1);
    const rules = await get("/api/rules");
    expect(rules.some((r: { payeeContains: string; toCategory: string }) => r.payeeContains === "whole foods" && r.toCategory === "Groceries")).toBe(true);
  });

  test("deletes a rule", async () => {
    const rules = await get("/api/rules");
    const res = await fetch(`${baseUrl}/api/rules/${rules[0].id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(await get("/api/rules")).toHaveLength(rules.length - 1);
  });
});

describe("POST /api/simplefin/connect", () => {
  test("refuses without a token file rather than failing obscurely", async () => {
    // The setup token is read from %LOCALAPPDATA%\\finance\\simplefin-token.txt
    // so it never has to be pasted into a chat or committed.
    const res = await post("/api/simplefin/connect");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/simplefin-token\.txt/i);
  });
});

describe("POST /api/simplefin/sync", () => {
  test("refuses to sync before the connector is set up", async () => {
    const res = await post("/api/simplefin/sync");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not connected/i);
  });
});

test("disconnect requires confirmation and removes only bank access and its token file", async () => {
  const { openRepo } = await import("../../server/db/openDb.js");
  const { autoSyncIfStale } = await import("../../server/services/connectorService.js");
  const repo = openRepo();
  const state = { accessUrl: "https://bridge.example.test/access", lastSyncedAt: null, earliestBackfilled: null, lastErrors: [] };
  repo.setSimpleFinState(state);
  const folder = join(process.env.LOCALAPPDATA!, "finance");
  const tokenName = "simplefin-token.txt";
  const tokenPath = join(folder, tokenName);
  const otherPath = join(folder, "keep.txt");
  writeFileSync(tokenPath, "invented setup token");
  writeFileSync(otherPath, "keep this file");
  const files = readdirSync(folder);
  const accountsBefore = repo.getAccounts();
  const transactionsBefore = repo.getTransactions();

  expect((await post("/api/simplefin/disconnect", { confirmed: "true" })).status).toBe(400);
  expect(repo.getSimpleFinState()).toEqual(state);
  expect(readFileSync(tokenPath, "utf8")).toBe("invented setup token");

  expect((await post("/api/simplefin/disconnect", { confirmed: true })).status).toBe(204);
  expect(repo.getSimpleFinState()?.accessUrl).toBeNull();
  expect(readdirSync(folder)).toEqual(files.filter((file) => file !== tokenName));
  expect(readFileSync(otherPath, "utf8")).toBe("keep this file");
  expect(repo.getAccounts()).toEqual(accountsBefore);
  expect(repo.getTransactions()).toEqual(transactionsBefore);
  expect((await get("/api/simplefin/status")).connected).toBe(false);
  expect(await autoSyncIfStale(Date.now, async () => { throw new Error("Unexpected bank request"); })).toBeNull();
});
