// tests/server/maaser-pot.test.ts -- the charity pot's settings:
// one account is the pot (migration 0033, accounts.maaser_pot) and the floor kept
// in it is the app setting maaser_floor_cents. Temp database, never the live one.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Account } from "../../src/domain/types.js";

let server: Server;
let baseUrl: string;
const json = (method: string, path: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = async (path: string) => (await fetch(`${baseUrl}${path}`)).json();
const accounts = async (): Promise<Account[]> => get("/api/accounts/manage");

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-maaser-pot-"));
  const { buildApp } = await import("../../server/app.js");
  const { openRepo } = await import("../../server/db/openDb.js");
  openRepo().upsertAccounts([
    { id: "chk", name: "Checking", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
    { id: "pot", name: "Lakeshore Giving Savings", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "me" },
    { id: "old", name: "Lakeshore Giving Savings (...4321)", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  ]);
  openRepo().setAccountArchived("old", true);
  // The pot account counts only while the charity pot is on.
  openRepo().setSetting("charity_pot", JSON.stringify({ on: true, name: "Giving", kind: "percent", fixedCents: null, fixedFrom: null, counts: { me: true, partner: false, joint: false } }));
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("which account is the pot", () => {
  test("none to start; switching one on marks it and switching another on moves the mark", async () => {
    expect((await accounts()).every((a) => !a.maaserPot)).toBe(true);
    expect((await json("POST", "/api/accounts/pot/maaser-pot", { on: true })).status).toBe(204);
    expect((await accounts()).find((a) => a.id === "pot")?.maaserPot).toBe(true);
    expect((await get("/api/accounts")).find((a: Account) => a.id === "pot")?.maaserPot).toBe(true);
    expect((await json("POST", "/api/accounts/chk/maaser-pot", { on: true })).status).toBe(204);
    const after = await accounts();
    expect(after.find((a) => a.id === "chk")?.maaserPot).toBe(true);
    expect(after.find((a) => a.id === "pot")?.maaserPot).toBe(false);
  });
  test("switching it off leaves no pot", async () => {
    expect((await json("POST", "/api/accounts/chk/maaser-pot", { on: false })).status).toBe(204);
    expect((await accounts()).every((a) => !a.maaserPot)).toBe(true);
  });
  test("an account the app does not know is refused, and the pot it had stays", async () => {
    expect((await json("POST", "/api/accounts/pot/maaser-pot", { on: true })).status).toBe(204);
    const res = await json("POST", "/api/accounts/missing/maaser-pot", { on: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No account/);
    expect((await accounts()).find((a) => a.id === "pot")?.maaserPot).toBe(true);
    expect((await json("POST", "/api/accounts/pot/maaser-pot", { on: false })).status).toBe(204);
  });
  test("an archived row may carry the switch alongside the live one; switching live rows on leaves it", async () => {
    expect((await json("POST", "/api/accounts/old/maaser-pot", { on: true })).status).toBe(204);
    expect((await json("POST", "/api/accounts/pot/maaser-pot", { on: true })).status).toBe(204);
    let rows = await accounts();
    expect(rows.filter((a) => a.maaserPot).map((a) => a.id).sort()).toEqual(["old", "pot"]);
    expect((await json("POST", "/api/accounts/chk/maaser-pot", { on: true })).status).toBe(204);
    rows = await accounts();
    expect(rows.filter((a) => a.maaserPot).map((a) => a.id).sort()).toEqual(["chk", "old"]);
    expect((await json("POST", "/api/accounts/old/maaser-pot", { on: false })).status).toBe(204);
    expect((await json("POST", "/api/accounts/chk/maaser-pot", { on: false })).status).toBe(204);
    expect((await accounts()).every((a) => !a.maaserPot)).toBe(true);
  });
  test("anything but on or off is refused in plain words", async () => {
    const res = await json("POST", "/api/accounts/pot/maaser-pot", { on: "yes" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/on or off/);
  });
});

describe("the floor kept in the pot", () => {
  test("nothing until one is typed, then it stays as set", async () => {
    expect(await get("/api/settings/maaser-floor")).toEqual({ floorCents: 0 });
    expect((await json("POST", "/api/settings/maaser-floor", { floorCents: 150000 })).status).toBe(204);
    expect(await get("/api/settings/maaser-floor")).toEqual({ floorCents: 150000 });
  });
  test("a negative amount or a fraction of a cent is refused in plain words", async () => {
    for (const bad of [-1, 12.5, "1500", null]) {
      const res = await json("POST", "/api/settings/maaser-floor", { floorCents: bad });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/whole dollars and cents/);
    }
    expect(await get("/api/settings/maaser-floor")).toEqual({ floorCents: 150000 });
  });
});

describe("the pot as Settings, Salary reads it", () => {
  test("the charity card saves a percent pot's rate in basis points; the salary settings read it as the share of pay", async () => {
    const pot = { on: true, name: "Giving", kind: "percent", fixedCents: null, fixedFrom: null, counts: { me: true, partner: false, joint: false } };
    expect((await json("PUT", "/api/settings/charity-pot", { ...pot, rateBps: 250 })).status).toBe(200);
    const salary = await get("/api/settings/salary");
    expect(salary.maaserRate).toBe(0.025);
    expect(salary.pot).toMatchObject({ ...pot, rateBps: 250, floorCents: 150000 });
  });
});
