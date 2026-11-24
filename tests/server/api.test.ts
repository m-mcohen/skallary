// tests/server/api.test.ts
// Integration tests proving the full route -> service -> repository -> SQLite
// path for the Task-5 endpoints (everything beyond /api/accounts, covered by
// accounts.test.ts). Runs against a temp DB (never the real
// %LOCALAPPDATA%\finance\finance.db) by pointing LOCALAPPDATA at a mkdtemp
// dir BEFORE the server's DB singleton (server/db/openDb.ts) is first opened
// -- dbPath() only reads the env var lazily, on openRepo()'s first call, so
// this is safe even though it's a module-level singleton. Mirrors the
// tests/server/accounts.test.ts pattern.
import { afterAll, beforeAll, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NormalizedTxn } from "../../src/domain/types.js";
import type { Plan, BudgetLine, Goal } from "../../src/domain/plan-types.js";

let server: Server;
let baseUrl: string;
let tmpDir: string;

const seedTxns: NormalizedTxn[] = [
  {
    sourceTransactionId: "txn-1",
    accountId: "acc-checking",
    date: "2026-01-15",
    amountCents: -4599,
    sourceCategory: "Groceries",
    merchant: "Test Grocer",
    isTransfer: false,
    sourceUpdatedAt: "2026-01-15T00:00:00.000Z",
  },
];

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "fin-api-test-"));
  process.env.LOCALAPPDATA = tmpDir;

  const { openRepo } = await import("../../server/db/openDb.js");
  const { buildApp } = await import("../../server/app.js");

  // Seed reads through NodeRepository (applies migrations via its constructor),
  // the same singleton the server's routes read from.
  openRepo().upsertTransactions(seedTxns);

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
  // life of the process (NodeRepository exposes no close()), so an immediate
  // rmSync races an open WAL file handle and throws EPERM on Windows.
});

// --- READ: GET /api/transactions --------------------------------------------

test("GET /api/transactions returns the seeded transactions with the UI's NormalizedTxn[] shape", async () => {
  const res = await fetch(`${baseUrl}/api/transactions`);
  expect(res.status).toBe(200);

  const body = (await res.json()) as NormalizedTxn[];
  expect(Array.isArray(body)).toBe(true);
  expect(body).toHaveLength(1);
  expect(body[0]).toMatchObject({
    sourceTransactionId: "txn-1",
    accountId: "acc-checking",
    date: "2026-01-15",
    amountCents: -4599, // integer cents preserved over the wire, no float coercion
    sourceCategory: "Groceries",
    merchant: "Test Grocer",
    isTransfer: false,
    sourceUpdatedAt: "2026-01-15T00:00:00.000Z",
  });
  expect(Object.keys(body[0]).sort()).toEqual(
    [
      "sourceTransactionId",
      "accountId",
      "date",
      "amountCents",
      "sourceCategory",
      "merchant",
      "isTransfer",
      "sourceUpdatedAt",
      // Added by the SimpleFIN connector (migration 0012). Monarch rows carry
      // these as null/false; SimpleFIN rows carry the raw bank memo the
      // categorization rules match on.
      "description",
      "memo",
      "payee",
      "mcc",
      "pending",
    ].sort()
  );
});

// --- WRITE round-trip: POST /api/plans, POST /api/budget-lines then GET back ---

test("POST /api/plans -> GET /api/plans/:id and GET /api/plans round-trip", async () => {
  const plan: Omit<Plan, "createdAt"> = {
    id: "plan-1",
    name: "Test Plan",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  };

  const createRes = await fetch(`${baseUrl}/api/plans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plan),
  });
  expect(createRes.status).toBe(200);
  const created = (await createRes.json()) as Plan;
  expect(created).toMatchObject(plan);
  expect(typeof created.createdAt).toBe("string");

  const getRes = await fetch(`${baseUrl}/api/plans/plan-1`);
  expect(getRes.status).toBe(200);
  expect(await getRes.json()).toEqual(created);

  const listRes = await fetch(`${baseUrl}/api/plans`);
  const list = (await listRes.json()) as Plan[];
  expect(list.map((p) => p.id)).toContain("plan-1");
});

test("GET /api/plans/:id returns null (not a 404 body) for an unknown id", async () => {
  const res = await fetch(`${baseUrl}/api/plans/does-not-exist`);
  expect(res.status).toBe(200);
  expect(await res.json()).toBeNull();
});

test("POST /api/budget-lines -> GET /api/plans/:planId/budget-lines round-trip, preserving the null period and integer cents", async () => {
  // plan-1 was created by the previous test; budget lines FK loosely on plan_id
  // (no DB-level foreign key -- see src/data/repo.node.ts) so this also works
  // standalone if test order changes.
  const line: BudgetLine = {
    planId: "plan-1",
    planningCategory: "Groceries",
    period: null, // "applies to every month" -- must survive the ''<->null boundary round-trip
    amountCents: 50000,
  };

  const postRes = await fetch(`${baseUrl}/api/budget-lines`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(line),
  });
  expect(postRes.status).toBe(204);

  const getRes = await fetch(`${baseUrl}/api/plans/plan-1/budget-lines`);
  expect(getRes.status).toBe(200);
  const lines = (await getRes.json()) as BudgetLine[];
  const found = lines.find((l) => l.planningCategory === "Groceries");
  expect(found).toBeDefined();
  // The critical assertion: server-side ''<->null mapping means the HTTP
  // caller always sees `null`, never the DB's empty-string sentinel.
  expect(found!.period).toBeNull();
  expect(found!.amountCents).toBe(50000);

  // Overriding a specific period must NOT clobber the default (null-period) row.
  const override: BudgetLine = { ...line, period: "2026-03", amountCents: 60000 };
  await fetch(`${baseUrl}/api/budget-lines`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(override),
  });
  const lines2 = (await (await fetch(`${baseUrl}/api/plans/plan-1/budget-lines`)).json()) as BudgetLine[];
  const groceryLines = lines2.filter((l) => l.planningCategory === "Groceries");
  expect(groceryLines).toHaveLength(2);
  expect(groceryLines.find((l) => l.period === null)?.amountCents).toBe(50000);
  expect(groceryLines.find((l) => l.period === "2026-03")?.amountCents).toBe(60000);
});

// --- WRITE round-trip: POST /api/goals then GET/DELETE ---------------------

test("POST /api/goals -> GET /api/goals -> DELETE /api/goals/:id round-trip", async () => {
  const goal: Goal = {
    id: "goal-1",
    name: "Emergency Fund",
    targetAmountCents: 1000000,
    targetDate: "2027-01-01",
    priority: 1,
    currentAmountCents: 250000,
  };

  const postRes = await fetch(`${baseUrl}/api/goals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(goal),
  });
  expect(postRes.status).toBe(204);

  const listRes = await fetch(`${baseUrl}/api/goals`);
  const list = (await listRes.json()) as Goal[];
  expect(list.find((g) => g.id === "goal-1")).toMatchObject(goal);

  const delRes = await fetch(`${baseUrl}/api/goals/goal-1`, { method: "DELETE" });
  expect(delRes.status).toBe(204);

  const listAfter = (await (await fetch(`${baseUrl}/api/goals`)).json()) as Goal[];
  expect(listAfter.find((g) => g.id === "goal-1")).toBeUndefined();
});

// --- WRITE round-trip: POST /api/category-mappings then GET ----------------

test("POST /api/category-mappings -> GET /api/category-mappings round-trip", async () => {
  const postRes = await fetch(`${baseUrl}/api/category-mappings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "AMEX_GROCERY", planning: "Groceries" }),
  });
  expect(postRes.status).toBe(204);

  const getRes = await fetch(`${baseUrl}/api/category-mappings`);
  expect(getRes.status).toBe(200);
  const map = (await getRes.json()) as Record<string, string>;
  expect(map.AMEX_GROCERY).toBe("Groceries");
});

// --- Goals: Monarch parity (migration 0018) ---------------------------------

test("POST /api/goals accepts the pre-0018 six-field payload and fills the defaults", async () => {
  const legacy = { id: "goal-legacy", name: "Old shape", targetAmountCents: 500000, targetDate: "2027-01-01", priority: 3, currentAmountCents: 12500 };
  const postRes = await fetch(`${baseUrl}/api/goals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(legacy),
  });
  expect(postRes.status).toBe(204);
  const list = (await (await fetch(`${baseUrl}/api/goals`)).json()) as Goal[];
  expect(list.find((g) => g.id === "goal-legacy")).toEqual({
    ...legacy,
    goalType: "savings",
    plannedMonthlyCents: 0,
    notes: "",
    archivedAt: null,
    // 0022: the goal-cost fields default.
    ongoingMonthlyCents: 0,
    ongoingStartedPeriod: null,
    ongoingBudgetLine: null,
    completedAt: null,
  });
  await fetch(`${baseUrl}/api/goals/goal-legacy`, { method: "DELETE" });
});

test("POST /api/goals rejects a zero target, an unknown template and a malformed date with a plain message", async () => {
  const base = { id: "goal-bad", name: "Bad", targetAmountCents: 100, targetDate: null, priority: 0, currentAmountCents: 0 };
  const post = (body: unknown) =>
    fetch(`${baseUrl}/api/goals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const zero = await post({ ...base, targetAmountCents: 0 });
  expect(zero.status).toBe(400);
  expect(await zero.json()).toEqual({ ok: false, error: "Target amount must be greater than zero." });

  const badType = await post({ ...base, goalType: "pay_off_debt" });
  expect(badType.status).toBe(400);
  expect(((await badType.json()) as any).error).toBe("Unknown goal type.");

  const badDate = await post({ ...base, targetDate: "next year" });
  expect(badDate.status).toBe(400);
  expect(((await badDate.json()) as any).error).toMatch(/Target date/);

  const negativePlan = await post({ ...base, plannedMonthlyCents: -1 });
  expect(negativePlan.status).toBe(400);

  const list = (await (await fetch(`${baseUrl}/api/goals`)).json()) as Goal[];
  expect(list.find((g) => g.id === "goal-bad")).toBeUndefined();
});

test("PUT /api/goals/:id/links replaces the goal's links; GET /api/goal-links lists them; DELETE goal removes them", async () => {
  const { openRepo } = await import("../../server/db/openDb.js");
  openRepo().upsertAccounts([
    { id: "acc-sav", name: "Savings", type: "savings", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
    { id: "acc-brok", name: "Brokerage", type: "brokerage", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  ]);
  const goal = { id: "goal-links", name: "Linked", goalType: "vacation", targetAmountCents: 300000, targetDate: null, priority: 0, currentAmountCents: 0, plannedMonthlyCents: 20000, notes: "", archivedAt: null };
  expect((await fetch(`${baseUrl}/api/goals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(goal) })).status).toBe(204);

  const put = (links: unknown) =>
    fetch(`${baseUrl}/api/goals/goal-links/links`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(links) });

  expect((await put([{ accountId: "acc-sav", mode: "entire" }, { accountId: "acc-brok", mode: "fixed", amountCents: 5000 }])).status).toBe(204);
  let links = (await (await fetch(`${baseUrl}/api/goal-links`)).json()) as any[];
  expect(links.filter((l) => l.goalId === "goal-links")).toEqual([
    { goalId: "goal-links", accountId: "acc-brok", mode: "fixed", amountCents: 5000 },
    { goalId: "goal-links", accountId: "acc-sav", mode: "entire", amountCents: null },
  ]);

  // Replace-all: only the slice remains, and it changed.
  expect((await put([{ accountId: "acc-brok", mode: "fixed", amountCents: 7500 }])).status).toBe(204);
  links = (await (await fetch(`${baseUrl}/api/goal-links`)).json()) as any[];
  expect(links.filter((l) => l.goalId === "goal-links")).toEqual([{ goalId: "goal-links", accountId: "acc-brok", mode: "fixed", amountCents: 7500 }]);

  expect((await fetch(`${baseUrl}/api/goals/goal-links`, { method: "DELETE" })).status).toBe(204);
  links = (await (await fetch(`${baseUrl}/api/goal-links`)).json()) as any[];
  expect(links.filter((l) => l.goalId === "goal-links")).toEqual([]);
});

test("PUT links: 404 for an unknown goal, 400 for a bad link, 409 when the entire balance is already another goal's", async () => {
  const { openRepo } = await import("../../server/db/openDb.js");
  openRepo().upsertAccounts([
    { id: "acc-sav2", name: "Savings 2", type: "savings", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  ]);
  const mk = (id: string) => ({ id, name: id, targetAmountCents: 100000, targetDate: null, priority: 0, currentAmountCents: 0 });
  for (const id of ["goal-a", "goal-b"]) {
    await fetch(`${baseUrl}/api/goals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mk(id)) });
  }
  const put = (goalId: string, links: unknown) =>
    fetch(`${baseUrl}/api/goals/${goalId}/links`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(links) });

  const missing = await put("goal-nope", [{ accountId: "acc-sav2", mode: "entire" }]);
  expect(missing.status).toBe(404);

  const badMode = await put("goal-a", [{ accountId: "acc-sav2", mode: "percent", amountCents: 10 }]);
  expect(badMode.status).toBe(400);
  expect(((await badMode.json()) as any).error).toBe("Each link is either the entire balance or a fixed amount.");

  const unknownAccount = await put("goal-a", [{ accountId: "acc-ghost", mode: "entire" }]);
  expect(unknownAccount.status).toBe(400);
  expect(((await unknownAccount.json()) as any).error).toBe("Unknown account.");

  const twice = await put("goal-a", [{ accountId: "acc-sav2", mode: "fixed", amountCents: 1 }, { accountId: "acc-sav2", mode: "fixed", amountCents: 2 }]);
  expect(twice.status).toBe(400);

  expect((await put("goal-a", [{ accountId: "acc-sav2", mode: "entire" }])).status).toBe(204);
  const conflict = await put("goal-b", [{ accountId: "acc-sav2", mode: "entire" }]);
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toEqual({ ok: false, error: "That account already funds another goal with its entire balance." });
  // Nor a fixed slice of it: the dialog never offered one, and since
  // The server refuses it too, so no dollar counts in two goals.
  expect((await put("goal-b", [{ accountId: "acc-sav2", mode: "fixed", amountCents: 250 }])).status).toBe(409);

  for (const id of ["goal-a", "goal-b"]) await fetch(`${baseUrl}/api/goals/${id}`, { method: "DELETE" });
});

// An archived goal kept its account links, so an entire-balance
// link still blocked every other goal from that account.
test("archiving a goal releases its account links, so another goal can take the entire balance", async () => {
  const { openRepo } = await import("../../server/db/openDb.js");
  openRepo().upsertAccounts([
    { id: "acc-rel", name: "Release me", type: "savings", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  ]);
  const mk = (id: string, archivedAt: string | null = null) => ({ id, name: id, goalType: "savings", targetAmountCents: 100000, targetDate: null, priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt });
  const post = (g: unknown) => fetch(`${baseUrl}/api/goals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(g) });
  const put = (goalId: string, links: unknown) => fetch(`${baseUrl}/api/goals/${goalId}/links`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(links) });
  const linksOf = async (goalId: string) => ((await (await fetch(`${baseUrl}/api/goal-links`)).json()) as any[]).filter((l) => l.goalId === goalId);

  await post(mk("goal-old"));
  await post(mk("goal-new"));
  expect((await put("goal-old", [{ accountId: "acc-rel", mode: "entire" }])).status).toBe(204);
  expect((await put("goal-new", [{ accountId: "acc-rel", mode: "entire" }])).status).toBe(409);

  // An ordinary edit keeps the links.
  expect((await post({ ...mk("goal-old"), name: "renamed" })).status).toBe(204);
  expect(await linksOf("goal-old")).toHaveLength(1);

  expect((await post(mk("goal-old", "2026-09-18T12:00:00.000Z"))).status).toBe(204);
  expect(await linksOf("goal-old")).toEqual([]);
  expect((await put("goal-new", [{ accountId: "acc-rel", mode: "entire" }])).status).toBe(204);

  for (const id of ["goal-old", "goal-new"]) await fetch(`${baseUrl}/api/goals/${id}`, { method: "DELETE" });
});

// A goal could take an account's entire balance
// while another goal held a fixed slice of it, so those dollars counted in
// both goals. The server now refuses it in both directions.
test("PUT links: 409 for an entire balance another goal slices, and for a slice of another goal's entire balance", async () => {
  const { openRepo } = await import("../../server/db/openDb.js");
  openRepo().upsertAccounts([
    { id: "acc-share", name: "Shared", type: "savings", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  ]);
  const mk = (id: string) => ({ id, name: id, goalType: "savings", targetAmountCents: 100000, targetDate: null, priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null });
  const post = (g: unknown) => fetch(`${baseUrl}/api/goals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(g) });
  const put = (goalId: string, links: unknown) => fetch(`${baseUrl}/api/goals/${goalId}/links`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(links) });
  const linksOf = async (goalId: string) => ((await (await fetch(`${baseUrl}/api/goal-links`)).json()) as any[]).filter((l) => l.goalId === goalId);

  await post(mk("goal-slice"));
  await post(mk("goal-whole"));
  expect((await put("goal-slice", [{ accountId: "acc-share", mode: "fixed", amountCents: 30000 }])).status).toBe(204);
  const refused = await put("goal-whole", [{ accountId: "acc-share", mode: "entire" }]);
  expect(refused.status).toBe(409);
  expect(JSON.stringify(await refused.json())).toMatch(/fixed amount of that account/);
  expect(await linksOf("goal-whole")).toEqual([]);

  // The reverse: once the slice is gone the entire link goes in, and a new slice is then refused.
  expect((await put("goal-slice", [])).status).toBe(204);
  expect((await put("goal-whole", [{ accountId: "acc-share", mode: "entire" }])).status).toBe(204);
  expect((await put("goal-slice", [{ accountId: "acc-share", mode: "fixed", amountCents: 100 }])).status).toBe(409);
  expect(await linksOf("goal-slice")).toEqual([]);

  for (const id of ["goal-slice", "goal-whole"]) await fetch(`${baseUrl}/api/goals/${id}`, { method: "DELETE" });
});

// A balance written through the API also leaves that
// day's reading, and the readings route returns it for the net worth chart.
test("GET /api/account-balance-readings returns the reading a balance write leaves for today", async () => {
  const { openRepo } = await import("../../server/db/openDb.js");
  const { localDateIso } = await import("../../src/domain/period.js");
  openRepo().upsertAccounts([
    { id: "acc-reading", name: "Reading", type: "checking", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  ]);
  const post = await fetch(`${baseUrl}/api/account-balances`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ accountId: "acc-reading", balanceCents: 12_345, asOf: "2026-10-01T12:00:00Z" }]),
  });
  expect(post.ok).toBe(true);

  const res = await fetch(`${baseUrl}/api/account-balance-readings`);
  expect(res.status).toBe(200);
  const rows = (await res.json()) as { accountId: string; recordedOn: string; balanceCents: number; asOf: string }[];
  expect(rows.filter((r) => r.accountId === "acc-reading")).toEqual([
    { accountId: "acc-reading", recordedOn: localDateIso(), balanceCents: 12_345, asOf: "2026-10-01T12:00:00Z" },
  ]);
});
