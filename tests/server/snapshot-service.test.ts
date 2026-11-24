// tests/server/snapshot-service.test.ts
//
// Pins that a snapshot writes on demand and that a second write appends a
// second row -- snapshots accumulate; they never overwrite. Uses the same
// temp-LOCALAPPDATA pattern as the other server tests.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Account } from "../../src/domain/types";
import type { AccountBalance, Plan } from "../../src/domain/plan-types";

let writeSnapshot: (planId: string, note?: string | null) => unknown;
let listSnapshots: (planId: string) => unknown[];
let tmp: string;
let closeDb: () => void = () => {};

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "fin-snapshot-test-"));
  process.env.LOCALAPPDATA = tmp;

  const { openRepo } = await import("../../server/db/openDb.js");
  const { writeSnapshot: ws } = await import("../../server/services/snapshotService.js");
  writeSnapshot = ws;

  const repo = openRepo();
  closeDb = () => (repo as unknown as { db: { close(): void } }).db.close();

  // Seed: a plan, two accounts, balances totaling $500 for a clean assertion.
  (repo as unknown as { createPlan: (p: Omit<Plan, "createdAt">) => Plan }).createPlan({
    id: "p1",
    name: "Test Plan",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  });

  const accounts: Account[] = [
    { id: "a1", name: "Checking", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
    { id: "a2", name: "Savings", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  ];
  repo.upsertAccounts(accounts);

  const balances: AccountBalance[] = [
    { accountId: "a1", balanceCents: 20_000, asOf: new Date().toISOString() },
    { accountId: "a2", balanceCents: 30_000, asOf: new Date().toISOString() },
  ];
  (repo as unknown as { upsertAccountBalances: (b: AccountBalance[]) => void }).upsertAccountBalances(balances);

  listSnapshots = (planId: string) =>
    (repo as unknown as { listSnapshotHistory: (id: string) => unknown[] }).listSnapshotHistory(planId);
});

// The database must be closed before Windows lets its folder go.
afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe("writeSnapshot", () => {
  test("writes a row with the current drawable liquid balance", () => {
    const entry = writeSnapshot("p1", "test-first") as { drawableCents: number; asOf: string };
    expect(entry.drawableCents).toBe(50_000);
    expect(entry.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const rows = listSnapshots("p1") as { note: string | null }[];
    expect(rows.some((r) => r.note === "test-first")).toBe(true);
  });

  test("a second write appends -- snapshots accumulate", () => {
    const before = (listSnapshots("p1") as unknown[]).length;
    writeSnapshot("p1", "test-second");
    const after = (listSnapshots("p1") as unknown[]).length;
    expect(after).toBe(before + 1);
  });
});
