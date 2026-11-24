// tests/server/maaser-marks.test.ts -- the two per-row charity marks: storage, the calls
// and the prepared inputs. Harness as transaction-notes.test.ts: a temp LOCALAPPDATA, buildApp(), listen(0).
import { afterAll, beforeAll, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: Server;
let baseUrl: string;
let openRepo: typeof import("../../server/db/openDb.js").openRepo;
const json = { "Content-Type": "application/json" };

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-marks-test-"));
  ({ openRepo } = await import("../../server/db/openDb.js"));
  const { buildApp } = await import("../../server/app.js");
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

test("a mark is saved, replaced in place, listed in id order, and deleted", () => {
  const repo = openRepo();
  repo.setMaaserMark({ sourceTransactionId: "simplefin:ACT-1:TRN-9", kind: "income", countedCents: 160000 }, "2026-10-25T00:00:00Z");
  repo.setMaaserMark({ sourceTransactionId: "simplefin:ACT-1:TRN-2", kind: "not_maaser", countedCents: null }, "2026-10-25T00:00:00Z");
  repo.setMaaserMark({ sourceTransactionId: "simplefin:ACT-1:TRN-9", kind: "income", countedCents: null }, "2026-10-25T00:01:00Z");
  expect(repo.listMaaserMarks().map((m) => [m.sourceTransactionId, m.kind, m.countedCents])).toEqual([
    ["simplefin:ACT-1:TRN-2", "not_maaser", null], ["simplefin:ACT-1:TRN-9", "income", null],
  ]);
  repo.deleteMaaserMark("simplefin:ACT-1:TRN-2");
  repo.deleteMaaserMark("simplefin:ACT-1:TRN-9");
  expect(repo.listMaaserMarks()).toHaveLength(0);
});

test("a mark follows a pending charge to its settled row, unless the settled row has its own", () => {
  const repo = openRepo();
  repo.setMaaserMark({ sourceTransactionId: "pend-1", kind: "not_maaser", countedCents: null }, "2026-10-25T00:00:00Z");
  expect(repo.moveMaaserMark("pend-1", "post-1")).toBe(true);
  expect(repo.listMaaserMarks().map((m) => m.sourceTransactionId)).toContain("post-1");
  repo.setMaaserMark({ sourceTransactionId: "pend-2", kind: "not_maaser", countedCents: null }, "2026-10-25T00:00:00Z");
  repo.setMaaserMark({ sourceTransactionId: "post-2", kind: "income", countedCents: 1 }, "2026-10-25T00:00:00Z");
  expect(repo.moveMaaserMark("pend-2", "post-2")).toBe(false);
  expect(repo.listMaaserMarks().find((m) => m.sourceTransactionId === "post-2")?.kind).toBe("income");
  for (const m of repo.listMaaserMarks()) repo.deleteMaaserMark(m.sourceTransactionId);
});

test("the database refuses a not-counted mark with an amount", () => {
  expect(() => openRepo().setMaaserMark({ sourceTransactionId: "x", kind: "not_maaser", countedCents: 5 }, "2026-10-25T00:00:00Z")).toThrow(/CHECK/);
});

// ---- HTTP: /api/maaser-marks ----
const put = (id: string, body: unknown) =>
  fetch(`${baseUrl}/api/maaser-marks/${encodeURIComponent(id)}`, { method: "PUT", headers: json, body: JSON.stringify(body) });
const del = (id: string) => fetch(`${baseUrl}/api/maaser-marks/${encodeURIComponent(id)}`, { method: "DELETE" });
const read = async () =>
  (await (await fetch(`${baseUrl}/api/maaser-marks`)).json()) as { sourceTransactionId: string; kind: string; countedCents: number | null }[];

test("seed an income row of $2,000 so the amount check has a row to read", () => {
  const repo = openRepo();
  repo.upsertAccounts([{ id: "chk", name: "Checking", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" }]);
  repo.upsertTransactions([{ sourceTransactionId: "inc-1", accountId: "chk", date: "2026-09-21", amountCents: 200000, sourceCategory: "Other Income", merchant: null, isTransfer: false, sourceUpdatedAt: null }]);
  expect(repo.getTransactions().some((t) => t.sourceTransactionId === "inc-1")).toBe(true);
});

test("PUT saves a mark, GET lists it, PUT again replaces it, DELETE removes it", async () => {
  expect((await put("inc-1", { kind: "income", countedCents: 160000 })).status).toBe(204);
  expect((await read()).map((m) => [m.sourceTransactionId, m.kind, m.countedCents])).toEqual([["inc-1", "income", 160000]]);
  expect((await put("inc-1", { kind: "income" })).status).toBe(204);
  expect((await read())[0].countedCents).toBeNull();
  expect((await del("inc-1")).status).toBe(204);
  expect(await read()).toEqual([]);
});

test("a refusal is plain words and writes nothing", async () => {
  for (const [body, words] of [
    [{ kind: "gift" }, "A mark is either not maaser or income for maaser."],
    [{ kind: "not_maaser", countedCents: 5 }, "Only an income mark can count part of the amount."],
    [{ kind: "income", countedCents: 12.5 }, "The part that counts is whole dollars and cents, above zero."],
    [{ kind: "income", countedCents: 200001 }, "The part that counts can be at most the row's amount."],
  ] as const) {
    const res = await put("inc-1", body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(words);
  }
  expect(await read()).toEqual([]);
});

test("a part equal to the row's amount is kept; a mark on a row the app does not know is kept too", async () => {
  expect((await put("inc-1", { kind: "income", countedCents: 200000 })).status).toBe(204);
  expect((await put("unknown-id", { kind: "not_maaser" })).status).toBe(204);
});

test("preparedInputs carries the marks", async () => {
  const { preparedInputs } = await import("../../server/services/seedBudgetService.js");
  expect(preparedInputs().marks.map((m) => m.sourceTransactionId).sort()).toEqual(["inc-1", "unknown-id"]);
});
