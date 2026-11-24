// tests/server/starter.test.ts -- the starter set (design 5.8): standard categories, rules for
// national merchants, and the three ways to start filing. Each test opens its own fresh database.
import { beforeEach, expect, test, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STANDARD_CATEGORIES, STARTER_RULES, isLockedCategory } from "../../src/domain/starter-set";
import { classify } from "../../src/domain/dedup";
import type { StarterFiling } from "../../src/domain/setup-progress";
import { demoAccounts, demoTransactions } from "../demo";

let starter: typeof import("../../server/services/starterService.js");
let settings: typeof import("../../server/services/settingsService.js");
let read: typeof import("../../server/services/readService.js");
let repo: import("../../src/data/repo.node.js").NodeRepository;

beforeEach(async () => {
  vi.resetModules();
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-starter-"));
  starter = await import("../../server/services/starterService.js");
  settings = await import("../../server/services/settingsService.js");
  read = await import("../../server/services/readService.js");
  repo = (await import("../../server/db/openDb.js")).openRepo();
});

test.each<[StarterFiling, string[] | undefined, () => number]>([
  ["standard-rules", undefined, () => STARTER_RULES.length],
  ["categories-only", undefined, () => 0],
  ["checklist", [STARTER_RULES[0].id, STARTER_RULES[1].id], () => 2],
])("filing choice %s writes the standard categories and its rules", (choice, ids, rules) => {
  const r = starter.applyStarterFiling(choice, ids);
  expect(r).toEqual({ categoriesAdded: STANDARD_CATEGORIES.length, rulesAdded: rules() });
  expect(settings.getStarterFiling()).toBe(choice);
});

test("applying a choice twice adds nothing", () => {
  starter.applyStarterFiling("standard-rules");
  expect(starter.applyStarterFiling("standard-rules")).toEqual({ categoriesAdded: 0, rulesAdded: 0 });
});

test("a category the household already files elsewhere keeps its mapping", () => {
  read.setCategoryMapping("groceries", "Food at home");
  const r = starter.applyStarterFiling("categories-only");
  expect(r.categoriesAdded).toBe(STANDARD_CATEGORIES.length - 1);
  expect(read.getCategoryMappings()["groceries"]).toBe("Food at home");
  expect(read.getCategoryMappings()["Groceries"]).toBeUndefined();
});

test("a rule id that is not a starter rule is refused and nothing is written", () => {
  expect(() => starter.applyStarterFiling("checklist", [STARTER_RULES[0].id, "no-such-rule"])).toThrow();
  expect(read.getCategoryMappings()).toEqual({});
  expect(repo.getCategorizationRules()).toEqual([]);
  expect(settings.getStarterFiling()).toBeNull();
});

test("a starter rule files a national merchant's demo transaction to its standard category", () => {
  const rule = STARTER_RULES[0];
  const row = demoTransactions().find((t) => (t.memo ?? "").toLowerCase().includes(rule.match.toLowerCase()));
  expect(row).toBeDefined();
  // As a bank feed sends it: no category of its own.
  repo.upsertAccounts(demoAccounts());
  repo.upsertTransactions([{ ...row!, sourceCategory: null }], "simplefin");
  starter.applyStarterFiling("standard-rules");
  const filed = read.getTransactions().find((t) => t.sourceTransactionId === row!.sourceTransactionId)!;
  expect(classify(filed, read.getCategoryMappings()).planningCategory).toBe(rule.planningCategory);
});

test("a learned or hand-written rule outranks a starter rule for the same merchant", () => {
  starter.applyStarterFiling("standard-rules");
  const rules = repo.getCategorizationRules();
  const learnedPriority = 500;
  expect(rules.every((r) => r.priority > learnedPriority)).toBe(true);
  expect(rules.some((r) => /^Learned from /.test(r.note ?? ""))).toBe(false);
});

test("a locked category's own mapping cannot be pointed elsewhere", async () => {
  starter.applyStarterFiling("categories-only");
  const { buildApp } = await import("../../server/app.js");
  const server: Server = await new Promise((resolve) => { const s = buildApp().listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/category-mappings`;
    const post = (source: string, planning: string) =>
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, planning }) });
    expect((await post("Paychecks", "Pay")).status).toBe(400);
    expect((await post("paychecks ", "Pay")).status).toBe(400);
    expect(read.getCategoryMappings()["Paychecks"]).toBe("Paychecks");
    expect((await post("Groceries", "Food")).status).toBe(204);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  expect(isLockedCategory("Groceries")).toBe(false);
});

test("POST /api/setup/starter applies the choice; a bad choice is refused", async () => {
  const { buildApp } = await import("../../server/app.js");
  const server: Server = await new Promise((resolve) => { const s = buildApp().listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/setup/starter`;
    const post = (body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ choice: "everything" })).status).toBe(400);
    const res = await post({ choice: "checklist", ruleIds: [STARTER_RULES[2].id] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ categoriesAdded: STANDARD_CATEGORIES.length, rulesAdded: 1 });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("every starter rule files to a standard category, and no two rules share a merchant", () => {
  const names = new Set(STANDARD_CATEGORIES.map((c) => c.name));
  expect(STARTER_RULES.filter((r) => !names.has(r.planningCategory))).toEqual([]);
  const keys = STARTER_RULES.map((r) => r.match.toLowerCase());
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(STARTER_RULES.map((r) => r.id)).size).toBe(STARTER_RULES.length);
});

test("ticking Uber alone leaves Uber Eats rows unfiled; ticking Uber Eats later files them", () => {
  const account = demoAccounts()[0];
  const row = (id: string, text: string) => ({
    sourceTransactionId: id, accountId: account.id, date: "2027-01-05", amountCents: -2_500, sourceCategory: null,
    merchant: text, payee: text, description: text, memo: "", isTransfer: false, sourceUpdatedAt: null, pending: false,
  });
  repo.upsertAccounts([account]);
  repo.upsertTransactions([row("ride", "UBER TRIP"), row("meal", "UBER EATS ORDER")], "simplefin");
  const categoryOf = (id: string) => read.getTransactions().find((t) => t.sourceTransactionId === id)!.sourceCategory;
  starter.applyStarterFiling("checklist", ["uber"]);
  expect(categoryOf("ride")).toBe("Taxi & Ride Shares");
  expect(categoryOf("meal")).toBeNull();
  starter.applyStarterFiling("checklist", ["uber-eats"]);
  expect(categoryOf("meal")).toBe("Restaurants & Bars");
});
