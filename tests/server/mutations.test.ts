// tests/server/mutations.test.ts
// Integration tests for the mutation-path endpoints added across the first build
// (delete-budget-line, bootstrap-mappings, seed-budget). Mirrors
// tests/server/api.test.ts's harness: a temp DB (mkdtemp over LOCALAPPDATA,
// read BEFORE the server's DB singleton is first opened), buildApp(),
// listen(0, "127.0.0.1"), plain fetch. This file is structured so later
// tasks (3, 4, 9) append more `describe` blocks rather than new test files.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BudgetLine, Plan } from "../../src/domain/plan-types.js";
import type { NormalizedTxn, Account } from "../../src/domain/types.js";
import type { NodeRepository } from "../../src/data/repo.node.js";
import type { Scenario } from "../../src/domain/scenario.js";
import type { CategorySetting } from "../../src/domain/category-settings.js";

let server: Server;
let baseUrl: string;
let tmpDir: string;
let repo: NodeRepository;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "fin-mutations-test-"));
  process.env.LOCALAPPDATA = tmpDir;

  const { buildApp } = await import("../../server/app.js");
  const { openRepo } = await import("../../server/db/openDb.js");
  repo = openRepo();

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
  // Not deleting tmpDir: better-sqlite3 keeps its file handle open for the
  // life of the process (see tests/server/api.test.ts for the same note).
});

async function createPlan(id: string): Promise<void> {
  const plan: Omit<Plan, "createdAt"> = {
    id,
    name: `Test Plan ${id}`,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  };
  const res = await fetch(`${baseUrl}/api/plans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plan),
  });
  expect(res.status).toBe(200);
}

async function postBudgetLine(line: BudgetLine): Promise<void> {
  const res = await fetch(`${baseUrl}/api/budget-lines`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(line),
  });
  expect(res.status).toBe(204);
}

async function getBudgetLines(planId: string): Promise<BudgetLine[]> {
  const res = await fetch(`${baseUrl}/api/plans/${encodeURIComponent(planId)}/budget-lines`);
  expect(res.status).toBe(200);
  return (await res.json()) as BudgetLine[];
}

describe("DELETE /api/budget-lines", () => {
  test("deleting a per-month override leaves the default line intact", async () => {
    const planId = "plan-delete-1";
    await createPlan(planId);

    await postBudgetLine({ planId, planningCategory: "Groceries", period: null, amountCents: 100000 });
    await postBudgetLine({ planId, planningCategory: "Groceries", period: "2026-03", amountCents: 150000 });

    // sanity: both lines exist before the delete
    const before = await getBudgetLines(planId);
    const groceryBefore = before.filter((l) => l.planningCategory === "Groceries");
    expect(groceryBefore).toHaveLength(2);

    const delRes = await fetch(
      `${baseUrl}/api/budget-lines?planId=${encodeURIComponent(planId)}&planningCategory=Groceries&period=2026-03`,
      { method: "DELETE" }
    );
    expect(delRes.status).toBe(204);

    const after = await getBudgetLines(planId);
    const groceryAfter = after.filter((l) => l.planningCategory === "Groceries");
    expect(groceryAfter).toHaveLength(1);
    expect(groceryAfter[0].period).toBeNull();
    expect(groceryAfter[0].amountCents).toBe(100000);
  });

  test("deleting with period omitted removes the default (period:null) line", async () => {
    const planId = "plan-delete-2";
    await createPlan(planId);

    await postBudgetLine({ planId, planningCategory: "Dining", period: null, amountCents: 40000 });
    await postBudgetLine({ planId, planningCategory: "Dining", period: "2026-05", amountCents: 90000 });

    const delRes = await fetch(
      `${baseUrl}/api/budget-lines?planId=${encodeURIComponent(planId)}&planningCategory=Dining`,
      { method: "DELETE" }
    );
    expect(delRes.status).toBe(204);

    const after = await getBudgetLines(planId);
    const diningAfter = after.filter((l) => l.planningCategory === "Dining");
    expect(diningAfter).toHaveLength(1);
    expect(diningAfter[0].period).toBe("2026-05");
    expect(diningAfter[0].amountCents).toBe(90000);
  });
});

describe("POST /api/bootstrap-mappings", () => {
  test("append-only: fills unmapped source categories, never touches an existing mapping", async () => {
    // Seed transactions covering three distinct source categories, including
    // a null sourceCategory (bootstrap treats null as "Uncategorized").
    const txns: NormalizedTxn[] = [
      {
        sourceTransactionId: "bm-txn-1",
        accountId: "acc-bm-1",
        date: "2026-01-05",
        amountCents: -5000,
        sourceCategory: "Groceries",
        merchant: "Toy Market",
        isTransfer: false,
        sourceUpdatedAt: null,
      },
      {
        sourceTransactionId: "bm-txn-2",
        accountId: "acc-bm-1",
        date: "2026-01-06",
        amountCents: -6000,
        sourceCategory: "Groceries",
        merchant: "Toy Market",
        isTransfer: false,
        sourceUpdatedAt: null,
      },
      {
        sourceTransactionId: "bm-txn-3",
        accountId: "acc-bm-1",
        date: "2026-01-07",
        amountCents: -2500,
        sourceCategory: "Dining",
        merchant: "Cafe",
        isTransfer: false,
        sourceUpdatedAt: null,
      },
      {
        sourceTransactionId: "bm-txn-4",
        accountId: "acc-bm-1",
        date: "2026-01-08",
        amountCents: -1000,
        sourceCategory: null,
        merchant: null,
        isTransfer: false,
        sourceUpdatedAt: null,
      },
    ];
    repo.upsertTransactions(txns);

    // Pre-existing custom mapping for a source category the user already
    // remapped -- bootstrap must leave this untouched (append-only).
    repo.setCategoryMapping("Groceries", "Food");

    const res = await fetch(`${baseUrl}/api/bootstrap-mappings`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: number; total: number };
    expect(body).toEqual({ added: 2, total: 3 });

    const mapRes = await fetch(`${baseUrl}/api/category-mappings`);
    expect(mapRes.status).toBe(200);
    const mappings = (await mapRes.json()) as Record<string, string>;
    expect(mappings["Groceries"]).toBe("Food"); // untouched, proves append-only
    expect(mappings["Dining"]).toBe("Dining");
    expect(mappings["Uncategorized"]).toBe("Uncategorized");
  });
});

describe("POST /api/plans/:id/seed-budget", () => {
  test("seeds expense defaults from a 3-month trailing window, skips income, preserves overrides, and applies a saved transfer adjustment", async () => {
    const planId = "plan-seed-1";
    await createPlan(planId);

    // Realistic shape: latest actual month is 2026-08 (partial), so a
    // 3-month window should be 2026-05/06/07 and 2026-08 must be excluded.
    const txns: NormalizedTxn[] = [
      // Groceries: 05=1000, 06=1200, 07=1100 -> avg 1100.00 = 110000 cents
      { sourceTransactionId: "sd-1", accountId: "acc-sd-1", date: "2026-05-05", amountCents: -100000, sourceCategory: "Groceries", merchant: "Toy Market", isTransfer: false, sourceUpdatedAt: null },
      { sourceTransactionId: "sd-2", accountId: "acc-sd-1", date: "2026-06-05", amountCents: -120000, sourceCategory: "Groceries", merchant: "Toy Market", isTransfer: false, sourceUpdatedAt: null },
      { sourceTransactionId: "sd-3", accountId: "acc-sd-1", date: "2026-07-05", amountCents: -110000, sourceCategory: "Groceries", merchant: "Toy Market", isTransfer: false, sourceUpdatedAt: null },
      // 2026-07 is the latest actual month present, so the service's
      // asOfMonth = nextMonth(latest) = 2026-08 and the 3-month window is
      // 2026-05/06/07 -- there is no 2026-08 data at all, which is exactly
      // how a real "current partial month" gets excluded (see
      // tests/domain/seed.test.ts for the pure exclusion assertion).
      // Dining: only in 07 -> missing months (05,06) count as 0 -> avg 20000
      { sourceTransactionId: "sd-5", accountId: "acc-sd-1", date: "2026-07-10", amountCents: -60000, sourceCategory: "Dining", merchant: "Cafe", isTransfer: false, sourceUpdatedAt: null },
      // Genuine income -- never auto-seeded.
      { sourceTransactionId: "sd-6", accountId: "acc-sd-1", date: "2026-06-01", amountCents: 500000, sourceCategory: "Salary", merchant: "Employer", isTransfer: false, sourceUpdatedAt: null },
      { sourceTransactionId: "sd-7", accountId: "acc-sd-1", date: "2026-07-15", amountCents: 10000, sourceCategory: "Paychecks", merchant: "Internal Transfer", isTransfer: false, sourceUpdatedAt: null },
    ];
    repo.addTransactionAdjustment({ matchKind: "category_amount", matchCategory: "Paychecks", matchAmountCents: 10000, action: "transfer" });
    repo.upsertTransactions(txns);
    repo.setCategoryMapping("Groceries", "Groceries");
    repo.setCategoryMapping("Dining", "Dining");
    repo.setCategoryMapping("Salary", "Income");
    repo.setCategoryMapping("Paychecks", "Income");

    // Pre-existing per-month override on Groceries -- must be preserved
    // untouched while its default (period:null) is overwritten by the seed.
    await postBudgetLine({ planId, planningCategory: "Groceries", period: "2026-03", amountCents: 1000000 });

    const res = await fetch(`${baseUrl}/api/plans/${encodeURIComponent(planId)}/seed-budget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ windowMonths: 3 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { window: string[]; seededCategories: number };
    expect(body.window).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(body.seededCategories).toBe(2); // Groceries + Dining, Income excluded

    const lines = await getBudgetLines(planId);

    const groceriesDefault = lines.find((l) => l.planningCategory === "Groceries" && l.period === null);
    expect(groceriesDefault).toBeDefined();
    expect(groceriesDefault!.amountCents).toBe(110000);

    const groceriesOverride = lines.find((l) => l.planningCategory === "Groceries" && l.period === "2026-03");
    expect(groceriesOverride).toBeDefined();
    expect(groceriesOverride!.amountCents).toBe(1000000); // untouched

    const diningDefault = lines.find((l) => l.planningCategory === "Dining" && l.period === null);
    expect(diningDefault).toBeDefined();
    expect(diningDefault!.amountCents).toBe(20000);

    const incomeLines = lines.filter((l) => l.planningCategory === "Income");
    expect(incomeLines).toHaveLength(0); // income never auto-seeded, including the adjusted transfer
  });
});

describe("GET/POST /api/transaction-adjustments", () => {
  test("POST adds a new adjustment and GET reflects it", async () => {
    const before = await fetch(`${baseUrl}/api/transaction-adjustments`);
    const beforeRows = (await before.json()) as unknown[];

    const postRes = await fetch(`${baseUrl}/api/transaction-adjustments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchKind: "id",
        sourceTransactionId: "adj-test-txn-1",
        action: "exclude",
        note: "test-added exclusion rule",
      }),
    });
    expect(postRes.status).toBe(204);

    const after = await fetch(`${baseUrl}/api/transaction-adjustments`);
    const afterRows = (await after.json()) as {
      matchKind: string; sourceTransactionId: string | null; action: string; note: string | null;
    }[];
    expect(afterRows.length).toBe(beforeRows.length + 1);
    const added = afterRows.find((r) => r.sourceTransactionId === "adj-test-txn-1");
    expect(added).toBeDefined();
    expect(added!.matchKind).toBe("id");
    expect(added!.action).toBe("exclude");
  });
});

describe("scenario CRUD endpoints", () => {
  test("POST /api/scenarios -> GET list/get -> DELETE round-trips a scenario over HTTP", async () => {
    const planId = "plan-scenario-1";
    await createPlan(planId);

    const scenario: Scenario = {
      id: "scn-1",
      planId,
      name: "Toy scenario",
      isDefault: false,
      income: {
        kind: "schedule",
        steps: [
          { fromPeriod: "2026-02", netMonthlyCents: 0 },
          { fromPeriod: "2026-04", netMonthlyCents: 400_000 },
        ],
      },
      expenseDeltas: [{ planningCategory: "Groceries", period: null, deltaCents: -20_600 }],
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    // GET /api/scenarios/:id on a nonexistent id -> 200 body null (mirrors getPlan).
    const missing = await fetch(`${baseUrl}/api/scenarios/${encodeURIComponent(scenario.id)}`);
    expect(missing.status).toBe(200);
    expect(await missing.json()).toBeNull();

    const postRes = await fetch(`${baseUrl}/api/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scenario),
    });
    expect(postRes.status).toBe(204);

    const listRes = await fetch(`${baseUrl}/api/plans/${encodeURIComponent(planId)}/scenarios`);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Scenario[];
    expect(list.map((s) => s.id)).toEqual(["scn-1"]);
    expect(list[0].isDefault).toBe(false);

    const getRes = await fetch(`${baseUrl}/api/scenarios/${encodeURIComponent(scenario.id)}`);
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as Scenario;
    expect(got.id).toBe("scn-1");
    expect(got.name).toBe(scenario.name);
    expect(got.income).toEqual(scenario.income);
    expect(got.expenseDeltas).toEqual(scenario.expenseDeltas);

    const delRes = await fetch(`${baseUrl}/api/scenarios/${encodeURIComponent(scenario.id)}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);

    const listAfterDelete = (await (await fetch(`${baseUrl}/api/plans/${encodeURIComponent(planId)}/scenarios`)).json()) as Scenario[];
    expect(listAfterDelete).toEqual([]);

    const getAfterDelete = await fetch(`${baseUrl}/api/scenarios/${encodeURIComponent(scenario.id)}`);
    expect(getAfterDelete.status).toBe(200);
    expect(await getAfterDelete.json()).toBeNull();
  });
});

describe("retired screens' endpoints", () => {
  // The Acquisition screen and its deal routes are gone.
  test("the removed acquisition routes answer not found", async () => {
    const planId = "plan-acq-gone";
    await createPlan(planId);
    expect((await fetch(`${baseUrl}/api/plans/${encodeURIComponent(planId)}/acquisition-deals`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/acquisition-deals/deal-1`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/acquisition-deals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/acquisition-deals/deal-1`, { method: "DELETE" })).status).toBe(404);
  });

  // The Wealth screen is retired, and its assumptions routes with it.
  test("the removed wealth assumptions routes answer not found", async () => {
    const planId = "plan-wealth-gone";
    await createPlan(planId);
    expect((await fetch(`${baseUrl}/api/plans/${encodeURIComponent(planId)}/wealth-assumptions`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/wealth-assumptions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(404);
  });
});

describe("account owner tags + include-partner setting (effective-account filter)", () => {
  test("GET /api/accounts/manage returns raw accounts with owner; owner/include round-trip via POST endpoints", async () => {
    const partnerAccount: Account = {
      id: "acc-owner-partner", name: "Toy Checking", type: "depository", institution: "Toy Bank",
      currency: "USD", isOwned: true, includeInSpend: true, owner: "me",
    };
    repo.upsertAccounts([partnerAccount]);

    const manageRes = await fetch(`${baseUrl}/api/accounts/manage`);
    expect(manageRes.status).toBe(200);
    const manageBody = (await manageRes.json()) as { id: string; owner: string; includeInSpend: boolean }[];
    const seeded = manageBody.find((a) => a.id === "acc-owner-partner");
    expect(seeded).toBeDefined();
    expect(seeded!.owner).toBe("me"); // default until re-tagged

    const ownerRes = await fetch(`${baseUrl}/api/accounts/${encodeURIComponent("acc-owner-partner")}/owner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: "partner" }),
    });
    expect(ownerRes.status).toBe(204);

    const afterOwner = (await (await fetch(`${baseUrl}/api/accounts/manage`)).json()) as { id: string; owner: string }[];
    expect(afterOwner.find((a) => a.id === "acc-owner-partner")!.owner).toBe("partner");

    const includeRes = await fetch(`${baseUrl}/api/accounts/${encodeURIComponent("acc-owner-partner")}/include`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeInSpend: false }),
    });
    expect(includeRes.status).toBe(204);

    const afterInclude = (await (await fetch(`${baseUrl}/api/accounts/manage`)).json()) as {
      id: string; includeInSpend: boolean;
    }[];
    expect(afterInclude.find((a) => a.id === "acc-owner-partner")!.includeInSpend).toBe(false);

    // Restore includeInSpend=true for the rest of this describe block's tests.
    await fetch(`${baseUrl}/api/accounts/${encodeURIComponent("acc-owner-partner")}/include`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeInSpend: true }),
    });
  });

  test("GET /api/accounts (effective) excludes a partner-owned account's balance from drawableLiquidCents when the toggle is off, includes it when on", async () => {
    const { drawableLiquidCents } = await import("../../src/domain/runway.js");

    // Ensure the toggle starts off for this test's assertions.
    await fetch(`${baseUrl}/api/settings/include-partner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includePartner: false }),
    });

    // upsertAccounts (the sync path) deliberately never writes owner --
    // like is_owned/include_in_spend, it's a user-editable local tag a re-sync
    // must never clobber. So seed via upsertAccounts (owner defaults to 'me'),
    // then re-tag via setAccountOwner, mirroring the real sync-then-tag flow.
    const partnerAccountId = "acc-drawable-partner";
    const partnerAccount: Account = {
      id: partnerAccountId, name: "Toy Savings", type: "depository", institution: "Toy Bank",
      currency: "USD", isOwned: true, includeInSpend: true, owner: "me",
    };
    repo.upsertAccounts([partnerAccount]);
    repo.setAccountOwner(partnerAccountId, "partner");
    repo.upsertAccountBalances([{ accountId: partnerAccountId, balanceCents: 500_000, asOf: "2026-09-01" }]);

    const settingsOffRes = await fetch(`${baseUrl}/api/settings/include-partner`);
    expect(settingsOffRes.status).toBe(200);
    expect(await settingsOffRes.json()).toEqual({ includePartner: false });

    const accountsOff = (await (await fetch(`${baseUrl}/api/accounts`)).json()) as {
      id: string; includeInSpend: boolean; owner: string; type: string | null;
    }[];
    const partnerRowOff = accountsOff.find((a) => a.id === partnerAccountId);
    expect(partnerRowOff).toBeDefined();
    expect(partnerRowOff!.includeInSpend).toBe(false); // effective: excluded while toggle is off

    const balances = (await (await fetch(`${baseUrl}/api/account-balances`)).json()) as {
      accountId: string; balanceCents: number; asOf: string;
    }[];

    const drawableOff = drawableLiquidCents(accountsOff as any, balances);

    // Flip the toggle on.
    const toggleOnRes = await fetch(`${baseUrl}/api/settings/include-partner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includePartner: true }),
    });
    expect(toggleOnRes.status).toBe(204);

    const settingsOnRes = await fetch(`${baseUrl}/api/settings/include-partner`);
    expect(await settingsOnRes.json()).toEqual({ includePartner: true });

    const accountsOn = (await (await fetch(`${baseUrl}/api/accounts`)).json()) as {
      id: string; includeInSpend: boolean;
    }[];
    const partnerRowOn = accountsOn.find((a) => a.id === partnerAccountId);
    expect(partnerRowOn!.includeInSpend).toBe(true); // effective: included once toggle is on

    const drawableOn = drawableLiquidCents(accountsOn as any, balances);

    // The partner's account's $5,000 balance is the delta between the two states.
    expect(drawableOn - drawableOff).toBe(500_000);

    // Reset the toggle back to off so it doesn't leak into other tests in this file.
    await fetch(`${baseUrl}/api/settings/include-partner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includePartner: false }),
    });
  });
});

async function getCategorySettings(): Promise<CategorySetting[]> {
  const res = await fetch(`${baseUrl}/api/category-settings`);
  expect(res.status).toBe(200);
  return (await res.json()) as CategorySetting[];
}

describe("category settings: recurring vs non-recurring + pinned budget lines", () => {
  test("seed skips a pinned category's amount (leaves the hand-set default untouched) but still (re)seeds an unpinned category; skippedPinned lists it", async () => {
    const planId = "plan-catset-pin-1";
    await createPlan(planId);

    const txns: NormalizedTxn[] = [
      // SeedPinCat: recurring (3/3 months) -> would auto-average to 100000, but it's pinned.
      { sourceTransactionId: "cs-pin-1", accountId: "acc-cs-1", date: "2026-05-05", amountCents: -100000, sourceCategory: "SeedPinCat", merchant: "M", isTransfer: false, sourceUpdatedAt: null },
      { sourceTransactionId: "cs-pin-2", accountId: "acc-cs-1", date: "2026-06-05", amountCents: -100000, sourceCategory: "SeedPinCat", merchant: "M", isTransfer: false, sourceUpdatedAt: null },
      { sourceTransactionId: "cs-pin-3", accountId: "acc-cs-1", date: "2026-07-05", amountCents: -100000, sourceCategory: "SeedPinCat", merchant: "M", isTransfer: false, sourceUpdatedAt: null },
      // SeedUnpinnedCat: occasional (1/3 months) -> auto-averages to 20000.
      { sourceTransactionId: "cs-unpin-1", accountId: "acc-cs-1", date: "2026-07-10", amountCents: -60000, sourceCategory: "SeedUnpinnedCat", merchant: "M", isTransfer: false, sourceUpdatedAt: null },
    ];
    repo.upsertTransactions(txns);
    repo.setCategoryMapping("SeedPinCat", "SeedPinCat");
    repo.setCategoryMapping("SeedUnpinnedCat", "SeedUnpinnedCat");

    // Hand-set default the seed must never overwrite.
    await postBudgetLine({ planId, planningCategory: "SeedPinCat", period: null, amountCents: 1000000 });

    const pinRes = await fetch(`${baseUrl}/api/category-settings/${encodeURIComponent("SeedPinCat")}/pinned`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    expect(pinRes.status).toBe(204);

    const res = await fetch(`${baseUrl}/api/plans/${encodeURIComponent(planId)}/seed-budget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ windowMonths: 3 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { window: string[]; seededCategories: number; skippedPinned: string[] };
    expect(body.skippedPinned).toContain("SeedPinCat");
    expect(body.skippedPinned).not.toContain("SeedUnpinnedCat");

    const lines = await getBudgetLines(planId);
    const pinnedDefault = lines.find((l) => l.planningCategory === "SeedPinCat" && l.period === null);
    expect(pinnedDefault).toBeDefined();
    expect(pinnedDefault!.amountCents).toBe(1000000); // unchanged by the seed

    const unpinnedDefault = lines.find((l) => l.planningCategory === "SeedUnpinnedCat" && l.period === null);
    expect(unpinnedDefault).toBeDefined();
    expect(unpinnedDefault!.amountCents).toBe(20000); // (re)seeded

    // The pinned category's recurring flag is still written (pinned only guards the amount).
    const settings = await getCategorySettings();
    const pinnedSetting = settings.find((s) => s.planningCategory === "SeedPinCat")!;
    expect(pinnedSetting.recurring).toBe(true);
    expect(pinnedSetting.pinned).toBe(true);
  });

  test("seed writes recurring/'auto' for an unset category, but never overrides a category the user has explicitly set (recurringSource:'user')", async () => {
    const planId = "plan-catset-recur-1";
    await createPlan(planId);

    const txns: NormalizedTxn[] = [
      // SeedRecurCat: recurring (3/3) -> auto-derived recurring=true.
      { sourceTransactionId: "cs-rec-1", accountId: "acc-cs-2", date: "2026-05-05", amountCents: -50000, sourceCategory: "SeedRecurCat", merchant: "M", isTransfer: false, sourceUpdatedAt: null },
      { sourceTransactionId: "cs-rec-2", accountId: "acc-cs-2", date: "2026-06-05", amountCents: -50000, sourceCategory: "SeedRecurCat", merchant: "M", isTransfer: false, sourceUpdatedAt: null },
      { sourceTransactionId: "cs-rec-3", accountId: "acc-cs-2", date: "2026-07-05", amountCents: -50000, sourceCategory: "SeedRecurCat", merchant: "M", isTransfer: false, sourceUpdatedAt: null },
      // SeedUserCat: also recurring (3/3) by the numbers, but the user has
      // explicitly marked it non-recurring -- the seed must leave that alone.
      { sourceTransactionId: "cs-usr-1", accountId: "acc-cs-2", date: "2026-05-05", amountCents: -70000, sourceCategory: "SeedUserCat", merchant: "M", isTransfer: false, sourceUpdatedAt: null },
      { sourceTransactionId: "cs-usr-2", accountId: "acc-cs-2", date: "2026-06-05", amountCents: -70000, sourceCategory: "SeedUserCat", merchant: "M", isTransfer: false, sourceUpdatedAt: null },
      { sourceTransactionId: "cs-usr-3", accountId: "acc-cs-2", date: "2026-07-05", amountCents: -70000, sourceCategory: "SeedUserCat", merchant: "M", isTransfer: false, sourceUpdatedAt: null },
    ];
    repo.upsertTransactions(txns);
    repo.setCategoryMapping("SeedRecurCat", "SeedRecurCat");
    repo.setCategoryMapping("SeedUserCat", "SeedUserCat");

    const userRes = await fetch(`${baseUrl}/api/category-settings/${encodeURIComponent("SeedUserCat")}/recurring`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recurring: false }),
    });
    expect(userRes.status).toBe(204);

    const res = await fetch(`${baseUrl}/api/plans/${encodeURIComponent(planId)}/seed-budget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ windowMonths: 3 }),
    });
    expect(res.status).toBe(200);

    const settings = await getCategorySettings();
    const recur = settings.find((s) => s.planningCategory === "SeedRecurCat")!;
    expect(recur.recurring).toBe(true);
    expect(recur.recurringSource).toBe("auto");

    const user = settings.find((s) => s.planningCategory === "SeedUserCat")!;
    expect(user.recurring).toBe(false); // unchanged by the seed, despite 3/3 months of data
    expect(user.recurringSource).toBe("user");
  });

  test("the 4 category-settings endpoints round-trip (GET, upsert, pinned toggle, recurring set-to-null reverts to auto)", async () => {
    const cat = "RoundTripCat";

    const postRes = await fetch(`${baseUrl}/api/category-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planningCategory: cat,
        recurring: true,
        recurringSource: "user",
        pinned: true,
      } satisfies CategorySetting),
    });
    expect(postRes.status).toBe(204);

    let settings = await getCategorySettings();
    let row = settings.find((s) => s.planningCategory === cat)!;
    expect(row).toEqual({ planningCategory: cat, recurring: true, recurringSource: "user", pinned: true });

    const pinnedOffRes = await fetch(`${baseUrl}/api/category-settings/${encodeURIComponent(cat)}/pinned`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: false }),
    });
    expect(pinnedOffRes.status).toBe(204);

    settings = await getCategorySettings();
    row = settings.find((s) => s.planningCategory === cat)!;
    expect(row.pinned).toBe(false);
    expect(row.recurring).toBe(true); // untouched by the pinned toggle

    const recurNullRes = await fetch(`${baseUrl}/api/category-settings/${encodeURIComponent(cat)}/recurring`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recurring: null }),
    });
    expect(recurNullRes.status).toBe(204);

    settings = await getCategorySettings();
    row = settings.find((s) => s.planningCategory === cat)!;
    expect(row.recurring).toBeNull();
    expect(row.recurringSource).toBe("auto");
    expect(row.pinned).toBe(false); // untouched by the recurring reset
  });
});

// The "This page answers" line's on/off switch.
describe("GET/POST /api/settings/guide", () => {
  test("defaults to shown when never set, and persists a change", async () => {
    const defaultRes = await fetch(`${baseUrl}/api/settings/guide`);
    expect(defaultRes.status).toBe(200);
    expect(await defaultRes.json()).toEqual({ show: true });

    const offRes = await fetch(`${baseUrl}/api/settings/guide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ show: false }),
    });
    expect(offRes.status).toBe(204);

    const afterOffRes = await fetch(`${baseUrl}/api/settings/guide`);
    expect(await afterOffRes.json()).toEqual({ show: false });

    // Restore the default for the rest of this file's tests.
    await fetch(`${baseUrl}/api/settings/guide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ show: true }),
    });
  });
});
