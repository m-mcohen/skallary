// tests/server/accounts.test.ts
// Integration test proving the full route -> service -> repository -> SQLite
// path for GET /api/accounts. Runs against a temp DB (never the real
// %LOCALAPPDATA%\finance\finance.db) by pointing LOCALAPPDATA at a mkdtemp
// dir BEFORE the server's DB singleton (server/db/openDb.ts) is first
// opened -- dbPath() only reads the env var lazily, on openRepo()'s first
// call, so this is safe even though it's a module-level singleton.
import { afterAll, beforeAll, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Account } from "../../src/domain/types.js";

let server: Server;
let baseUrl: string;
let tmpDir: string;

const seedAccounts: Account[] = [
  { id: "acc-checking", name: "Test Checking", type: "depository", institution: "Test Bank", currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  { id: "acc-savings", name: "Test Savings", type: "depository", institution: "Test Bank", currency: "USD", isOwned: true, includeInSpend: false, owner: "me" },
];

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "fin-accounts-test-"));
  process.env.LOCALAPPDATA = tmpDir;

  // Import AFTER LOCALAPPDATA is pointed at the temp dir: dbPath()/openRepo()
  // (server/db/openDb.ts) only resolve the DB path lazily on first call, but
  // importing after the env var is set keeps this test order-independent of
  // that implementation detail.
  const { openRepo } = await import("../../server/db/openDb.js");
  const { buildApp } = await import("../../server/app.js");

  // Seed through NodeRepository (applies migrations via its constructor),
  // the same singleton the server's routes read from.
  openRepo().upsertAccounts(seedAccounts);

  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  // Not deleting tmpDir here: better-sqlite3 keeps its file handle open for
  // the life of the process (NodeRepository exposes no close()), so an
  // immediate rmSync races an open WAL file handle and throws EPERM on
  // Windows. Matches the existing tests/cli/*.test.ts convention of leaving
  // mkdtemp dirs for the OS to reclaim.
});

test("GET /api/accounts returns the seeded accounts with the UI's Account[] shape", async () => {
  const res = await fetch(`${baseUrl}/api/accounts`);
  expect(res.status).toBe(200);

  const body = (await res.json()) as Account[];
  expect(Array.isArray(body)).toBe(true);
  expect(body).toHaveLength(2);

  const checking = body.find((a) => a.id === "acc-checking");
  expect(checking).toMatchObject({
    id: "acc-checking",
    name: "Test Checking",
    type: "depository",
    institution: "Test Bank",
    currency: "USD",
    isOwned: true,
    includeInSpend: true,
  });

  const savings = body.find((a) => a.id === "acc-savings");
  expect(savings).toMatchObject({ id: "acc-savings", includeInSpend: false });

  // Exact field set -- no extra/renamed keys leaking through the JSON boundary.
  expect(Object.keys(checking!).sort()).toEqual(
    [
      "currency", "id", "includeInSpend", "institution", "isOwned", "name", "owner", "type",
      // Added by the SimpleFIN connector (migration 0012): who last set the type
      // (a 'user' value is never overwritten by a sync) and the feed's own
      // balance snapshot, shown so "last refreshed" is honest.
      "typeSource", "balanceCents", "availableBalanceCents", "balanceDate",
      // Migration 0015: a superseded account record, hidden from the accounts
      // list but still owning its history and still in every total.
      "archived",
      // Migration 0033: the charity pot, the one account a share of pay is set aside in.
      "maaserPot",
      // Migration 0020: where money put away in this account lands --
      // 'Investing', 'Retirement', or null for an ordinary account.
      "savingsDestination",
    ].sort()
  );
});
