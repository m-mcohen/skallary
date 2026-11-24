// tests/server/categorizations.test.ts
// Filing writes and undo restores their previous state.
// Harness as tests/server/recurring-choices.test.ts: a temp LOCALAPPDATA, buildApp(), listen(0).
import { afterAll, beforeAll, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

let server: Server;
let baseUrl: string;
let dbFile: string;
const json = { "Content-Type": "application/json" };

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-categorizations-test-"));
  dbFile = join(process.env.LOCALAPPDATA, "finance", "finance.db");
  const { buildApp } = await import("../../server/app.js");
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

const call = (path: string, method = "GET", body?: unknown) =>
  fetch(`${baseUrl}/api${path}`, { method, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
const get = async (path: string) => (await call(path)).json();
const file = async (body: unknown) => {
  const res = await call("/categorizations", "POST", body);
  expect(res.status).toBe(200);
  return (await res.json()) as { id: number };
};
const undo = async (id: number) => (await (await call(`/categorizations/${id}/undo`, "POST")).json()) as { undone: boolean };
/** Everything a filing can touch, in a form two reads can be compared by. */
const state = async () => ({
  rules: (await get("/rules")).map((r: any) => [r.payeeContains, r.action, r.toCategory]),
  adjustments: (await get("/transaction-adjustments")).map((a: any) => [a.sourceTransactionId, a.action, a.toCategory]),
  notes: (await get("/transaction-notes")).map((n: any) => [n.sourceTransactionId, n.note]),
  choices: (await get("/recurring-choices")).map((c: any) => [c.payeeKey, c.accountId, c.choice, c.cadence, c.createdAt]),
});

const rule = (to: string, payee = "shell") => ({ priority: 100, payeeContains: payee, action: "categorize", toCategory: to, note: "Set from Now" });
const base = { sourceTransactionId: "t1", label: "Shell", fromCategory: "Fuel", toCategory: "Gas", rule: rule("Gas"), adjustment: null };

test("a merchant rule over an older rule: undo brings the older rule back into force", async () => {
  await call("/rules", "POST", rule("Fuel"));
  const before = await state();
  const { id } = await file(base);
  expect((await state()).rules).toContainEqual(["shell", "categorize", "Gas"]);
  expect(await undo(id)).toEqual({ undone: true });
  expect(await state()).toEqual(before);
});

test("a one-row change, and one plus a rule, are each undone exactly", async () => {
  const before = await state();
  const adj = { matchKind: "id", sourceTransactionId: "t2", action: "recategorize", toCategory: "Gas", note: "Set from Transactions" };
  const one = await file({ ...base, sourceTransactionId: "t2", rule: null, adjustment: adj });
  const both = await file({ ...base, sourceTransactionId: "t2", rule: rule("Gas"), adjustment: adj });
  expect((await state()).adjustments).toContainEqual(["t2", "recategorize", "Gas"]);
  await undo(both.id);
  await undo(one.id);
  expect(await state()).toEqual(before);
});

test("a recurring mark that replaced an earlier mark is put back whole; one with no earlier mark is removed", async () => {
  await call("/recurring-choices", "PUT", { payeeKey: "netflix", accountId: "a1", choice: "recurring", cadence: "monthly", label: "Netflix" });
  const before = await state();
  const save = { action: "save", choice: { payeeKey: "netflix", accountId: "a1", choice: "recurring", cadence: "annual", label: "Netflix" } };
  const a = await file({ ...base, recurring: save });
  const fresh = { action: "save", choice: { payeeKey: "hulu", accountId: "a1", choice: "recurring", cadence: "monthly", label: "Hulu" } };
  const b = await file({ ...base, recurring: fresh });
  expect((await state()).choices.map((c: unknown[]) => c[0])).toContain("hulu");
  await undo(b.id);
  await undo(a.id);
  expect(await state()).toEqual(before);
});

test("removing a recurring mark while filing and undoing restores the mark", async () => {
  await call("/recurring-choices", "PUT", { payeeKey: "gym", accountId: "a1", choice: "recurring", cadence: "monthly", label: "Gym" });
  const before = await state();
  const { id } = await file({ ...base, recurring: { action: "remove", payeeKey: "gym", accountId: "a1" } });
  expect((await state()).choices.map((c: unknown[]) => c[0])).not.toContain("gym");
  await undo(id);
  expect(await state()).toEqual(before);
});

test("undo leaves the note alone", async () => {
  const { id } = await file({ ...base, sourceTransactionId: "t3", note: "Road trip" });
  expect((await state()).notes).toContainEqual(["t3", "Road trip"]);
  await undo(id);
  expect((await state()).notes).toContainEqual(["t3", "Road trip"]);
});

test("a second undo of the same line does nothing", async () => {
  const { id } = await file(base);
  expect(await undo(id)).toEqual({ undone: true });
  const after = await state();
  expect(await undo(id)).toEqual({ undone: false });
  expect(await state()).toEqual(after);
});

test("undoing an older filing leaves a newer filing of the same merchant in force, and its recurring mark", async () => {
  const markA = { action: "save", choice: { payeeKey: "spotify", accountId: "a1", choice: "recurring", cadence: "monthly", label: "Spotify" } };
  const markB = { action: "save", choice: { ...markA.choice, cadence: "annual" } };
  const older = await file({ ...base, rule: rule("Music", "spotify"), recurring: markA });
  await file({ ...base, rule: rule("Streaming", "spotify"), recurring: markB });
  await undo(older.id);
  const s = await state();
  expect(s.rules).toContainEqual(["spotify", "categorize", "Streaming"]);
  expect(s.rules).not.toContainEqual(["spotify", "categorize", "Music"]);
  expect(s.choices.find((c: unknown[]) => c[0] === "spotify")?.slice(0, 4)).toEqual(["spotify", "a1", "recurring", "annual"]);
});

test("a filing writes everything or nothing", async () => {
  const before = await state();
  const db = new Database(dbFile);
  db.exec("CREATE TRIGGER fail_log BEFORE INSERT ON categorization_log BEGIN SELECT RAISE(ABORT, 'log write failed'); END");
  try {
    const res = await call("/categorizations", "POST", {
      ...base, sourceTransactionId: "t4", note: "half?", rule: rule("Gas"),
      adjustment: { matchKind: "id", sourceTransactionId: "t4", action: "recategorize", toCategory: "Gas" },
      recurring: { action: "save", choice: { payeeKey: "shell", accountId: "a1", choice: "recurring", cadence: "monthly", label: "Shell" } },
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("The filing was not saved. Nothing changed.");
  } finally {
    db.exec("DROP TRIGGER fail_log");
    db.close();
  }
  expect(await state()).toEqual(before);
});

test("a bad filing is refused in plain words; an unknown undo is 404", async () => {
  const res = await call("/categorizations", "POST", { ...base, rule: { ...rule("Gas"), payeeContains: "" } });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("This transaction has no merchant name, so it cannot become a rule.");
  expect((await call("/categorizations/99999/undo", "POST")).status).toBe(404);
  expect((await call("/categorizations/abc/undo", "POST")).status).toBe(404);
});

test("a one-row change can be deleted by its own call", async () => {
  expect((await call("/transaction-adjustments/99999", "DELETE")).status).toBe(204);
});

test("Recent categorizations lists the last 30 days, newest first, and marks the undone ones", async () => {
  const list = (await get("/categorizations")) as { id: number; undoneAt: string | null; label: string }[];
  expect(list.length).toBeGreaterThan(3);
  expect(list.map((e) => e.id)).toEqual([...list.map((e) => e.id)].sort((x, y) => y - x));
  expect(list.some((e) => e.undoneAt)).toBe(true);
  expect(list[0].label).toBe("Shell");
});

// When two rules cover a merchant, the most recent filing should take precedence.
test("a second filing of the same merchant gets a rule that wins over the first", async () => {
  await file({ ...base, rule: rule("Fuel", "texaco") });
  await file({ ...base, rule: rule("Gas", "texaco") });
  const rules = ((await get("/rules")) as { payeeContains: string; toCategory: string; priority: number; id: number }[])
    .filter((r) => r.payeeContains === "texaco");
  const fuel = rules.find((r) => r.toCategory === "Fuel")!;
  const gas = rules.find((r) => r.toCategory === "Gas")!;
  // Rules apply in priority order, lowest number first: the newer must come first.
  expect(gas.priority).toBeLessThan(fuel.priority);
});

// Undoing either filing must respect any change still in effect.
test("undoing two filings of the same merchant oldest first leaves no mark", async () => {
  const mark = (cadence: string) => ({ action: "save", choice: { payeeKey: "hbo", accountId: "a1", choice: "recurring", cadence, label: "HBO" } });
  const a = await file({ ...base, recurring: mark("monthly") });
  const b = await file({ ...base, recurring: mark("annual") });
  await undo(a.id);
  expect((await state()).choices.find((c: unknown[]) => c[0] === "hbo")?.[3]).toBe("annual");
  await undo(b.id);
  expect((await state()).choices.some((c: unknown[]) => c[0] === "hbo")).toBe(false);
});

test("undoing an amount-specific filing keeps the other recurring charge from the same payee", async () => {
  await call("/recurring-choices", "PUT", { payeeKey: "sample supplier", accountId: "a1", choice: "recurring", cadence: "monthly", label: "Supply box", amountCents: 2_000 });
  const paper = { action: "save", choice: { payeeKey: "sample supplier", accountId: "a1", choice: "recurring", cadence: "monthly", label: "Paper order", amountCents: 1_000 } };
  const a = await file({ ...base, recurring: paper });
  let choices = await get("/recurring-choices");
  expect(choices.filter((c: any) => c.payeeKey === "sample supplier").map((c: any) => c.amountCents).sort()).toEqual([1_000, 2_000]);
  expect((await call(`/categorizations/${a.id}/undo`, "POST")).status).toBe(200);
  choices = await get("/recurring-choices");
  expect(choices.filter((c: any) => c.payeeKey === "sample supplier").map((c: any) => c.amountCents)).toEqual([2_000]);
});
