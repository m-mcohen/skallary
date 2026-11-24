// tests/server/income-partial-save.test.ts
//
// A Save salary request whose
// body leaves out currentSalary or additionalSalary cleared that stored salary. The route's
// rule for every other field is "absent: left as saved; present (null included): written",
// and the two salaries now follow it too. An explicit null still clears (the card's None),
// and the check on the salaries (no start month, below zero) runs on the salaries in force
// after the save. Through the real app on a temporary database, as paycheck-settings does.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: Server;
let baseUrl: string;
const json = (method: string, path: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = async (path: string) => (await fetch(`${baseUrl}${path}`)).json();

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-income-partial-"));
  const { buildApp } = await import("../../server/app.js");
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

// The case: $120,000 a year, and a $2,000 additional monthly amount.
const current = { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "2026-11" };
const additional = { kind: "monthly", monthlyCents: 200_000, fromPeriod: "2026-12" };

describe("a Save salary request that leaves a salary out leaves it as saved", () => {
  test("a body of only the pay schedule keeps both salaries", async () => {
    expect((await json("POST", "/api/settings/income", { currentSalary: current, additionalSalary: additional })).status).toBe(204);
    expect((await json("POST", "/api/settings/income", { paySchedule: "monthly" })).status).toBe(204);
    const s = await get("/api/settings/salary");
    expect(s.paySchedule).toBe("monthly");
    expect(s.currentSalary).toEqual(current);
    expect(s.additionalSalary).toEqual(additional);
  });

  test("each salary on its own: the one in the body is written, the one left out is kept", async () => {
    const raised = { ...current, grossAnnualCents: 13_000_000 };
    expect((await json("POST", "/api/settings/income", { currentSalary: raised })).status).toBe(204);
    let s = await get("/api/settings/salary");
    expect([s.currentSalary, s.additionalSalary]).toEqual([raised, additional]);
    const more = { ...additional, monthlyCents: 250_000 };
    expect((await json("POST", "/api/settings/income", { additionalSalary: more })).status).toBe(204);
    s = await get("/api/settings/salary");
    expect([s.currentSalary, s.additionalSalary]).toEqual([raised, more]);
    // Put back for the tests below.
    expect((await json("POST", "/api/settings/income", { currentSalary: current, additionalSalary: additional })).status).toBe(204);
  });

  test("an explicit null still clears: None for the additional salary keeps the salary", async () => {
    expect((await json("POST", "/api/settings/income", { additionalSalary: null })).status).toBe(204);
    let s = await get("/api/settings/salary");
    expect([s.currentSalary, s.additionalSalary]).toEqual([current, null]);
    expect((await json("POST", "/api/settings/income", { currentSalary: null })).status).toBe(204);
    s = await get("/api/settings/salary");
    expect([s.currentSalary, s.additionalSalary]).toEqual([null, null]);
    expect((await json("POST", "/api/settings/income", { currentSalary: current, additionalSalary: additional })).status).toBe(204);
  });

  test("a bad salary in the body is still refused, and nothing is stored", async () => {
    const res = await json("POST", "/api/settings/income", { additionalSalary: { kind: "monthly", monthlyCents: -5, fromPeriod: "2026-12" }, paySchedule: "weekly" });
    expect(res.status).toBe(400);
    const s = await get("/api/settings/salary");
    expect([s.currentSalary, s.additionalSalary, s.paySchedule]).toEqual([current, additional, "monthly"]);
  });
});
