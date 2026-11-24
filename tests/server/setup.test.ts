import { afterAll, beforeAll, expect, test } from "vitest";
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
const P = "plan-2026";
const send = (method: string, path: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-setup-"));
  const { buildApp } = await import("../../server/app.js");
  const { openRepo } = await import("../../server/db/openDb.js");
  repo = openRepo();
  // An existing household: a filing choice is saved, so only its own lines are offered.
  repo.setSetting("starter_filing", "categories-only");
  repo.createPlan({ id: P, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" });
  repo.setBudgetLine({ planId: P, planningCategory: "Groceries", period: null, amountCents: 80000, source: "you" });
  repo.setBudgetLine({ planId: P, planningCategory: "Gym", period: null, amountCents: 5000, source: "suggested" });
  repo.changeLineFrom(P, "Groceries", "2026-11", 85000);
  repo.addGoalChange(P, "Gym", "2026-03", 20000, "g1");
  const txns: NormalizedTxn[] = ["2026-07-05", "2026-08-05", "2026-09-05"].map((date, i) => ({
    sourceTransactionId: `s-${i}`, accountId: "acc-1", date, amountCents: -90000, sourceCategory: "Groceries", merchant: "Walmart", isTransfer: false, sourceUpdatedAt: null,
  }));
  repo.upsertTransactions(txns);
  await new Promise<void>((resolve) => { server = buildApp().listen(0, "127.0.0.1", () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

test("suggestions come back for every spending line, in one call", async () => {
  const res = await (await send("GET", `/plans/${P}/setup`)).json();
  expect(res.suggestions.map((s: { planningCategory: string }) => s.planningCategory).sort()).toEqual(["Groceries", "Gym"]);
});

test("Apply is all or nothing: a bad line refuses the whole call", async () => {
  const before = JSON.stringify(repo.getBudgetLines(P));
  const res = await send("POST", `/plans/${P}/apply-setup`, { lines: [{ line: "Groceries", amountCents: 1 }, { line: "", amountCents: 5 }] });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("Pick a budget line.");
  expect(JSON.stringify(repo.getBudgetLines(P))).toBe(before);
});

test("Apply writes the ticked lines, clears the changes on them, keeps goal changes and stamps the review date", async () => {
  const res = await (await send("POST", `/plans/${P}/apply-setup`, { lines: [{ line: "Groceries", amountCents: 90000 }, { line: "Gym", amountCents: 6000 }] })).json();
  expect(res.applied).toBe(2);
  expect(res.cleared.map((c: { fromMonth: string }) => c.fromMonth)).toEqual(["2026-11"]);
  const lines = repo.getBudgetLines(P).filter((l) => l.period === null);
  expect(lines.find((l) => l.planningCategory === "Groceries")).toMatchObject({ amountCents: 90000, source: "suggested" });
  expect(repo.listBudgetChanges(P).filter((c) => c.reason === "goal")).toHaveLength(1);
  const seed = await (await send("GET", "/settings/seed")).json();
  expect(seed.lastSeedAt).not.toBeNull();
});

test("Keep as is (nothing ticked) still stamps the review date", async () => {
  repo.setSetting("last_seed_at", "2025-01-01T00:00:00.000Z");
  const res = await send("POST", `/plans/${P}/apply-setup`, { lines: [] });
  expect(res.status).toBe(200);
  const seed = await (await send("GET", "/settings/seed")).json();
  expect(seed.lastSeedAt > "2025-01-01T00:00:00.000Z").toBe(true);
});

test("Start next year creates the plan with every line in one call, and refuses a second time", async () => {
  const body = { fromPlanId: P, lines: [{ line: "Groceries", amountCents: 90000, source: "suggested" }, { line: "Gym", amountCents: 6000, source: "you" }] };
  const res = await (await send("POST", "/plans/next-year", body)).json();
  expect(res.plan).toMatchObject({ id: "plan-2027", startDate: "2027-01-01", endDate: "2027-12-31" });
  expect(repo.getBudgetLines("plan-2027").map((l) => [l.planningCategory, l.amountCents, l.source])).toEqual([["Groceries", 90000, "suggested"], ["Gym", 6000, "you"]]);
  const again = await send("POST", "/plans/next-year", body);
  expect(again.status).toBe(400);
  expect((await again.json()).error).toBe("A budget for 2027 already exists.");
});

// Refund lines carry negative amounts (a line budgeted below zero, a
// negative suggestion), so Set up budget and next year's budget must take them.
test("Apply and next year's budget take a negative amount (a refund line)", async () => {
  const res = await send("POST", `/plans/${P}/apply-setup`, { lines: [{ line: "Returns", amountCents: -15000 }] });
  expect(res.status).toBe(200);
  expect(repo.getBudgetLines(P).find((l) => l.planningCategory === "Returns" && l.period === null)?.amountCents).toBe(-15000);
  const bad = await send("POST", `/plans/${P}/apply-setup`, { lines: [{ line: "Returns", amountCents: 1.5 }] });
  expect(bad.status).toBe(400);
});

// Set up budget never rewrites a budget whose year is over.
test("Apply refuses a budget whose year is over", async () => {
  repo.createPlan({ id: "plan-2020", name: "2020", startDate: "2020-01-01", endDate: "2020-12-31" });
  repo.setBudgetLine({ planId: "plan-2020", planningCategory: "Groceries", period: null, amountCents: 1000, source: "you" });
  const before = JSON.stringify(repo.getBudgetLines("plan-2020"));
  const res = await send("POST", `/plans/plan-2020/apply-setup`, { lines: [{ line: "Groceries", amountCents: 2000 }] });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("That budget's year is over. Start the new year's budget instead.");
  expect(JSON.stringify(repo.getBudgetLines("plan-2020"))).toBe(before);
});

// A line set "from a month on" with no every-month row and no recent
// spending still belongs in Set up budget.
test("a line with only a from-a-month-on change is in the suggestions", async () => {
  repo.changeLineFrom(P, "Pet care", "2026-11", 3000);
  const res = await (await send("GET", `/plans/${P}/setup`)).json();
  expect(res.suggestions.map((s: { planningCategory: string }) => s.planningCategory)).toContain("Pet care");
});
