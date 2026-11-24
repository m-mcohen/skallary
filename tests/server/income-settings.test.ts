// tests/server/income-settings.test.ts
//
// The current salary and an optional additional salary live
// in Settings, Salary (app_settings), beside the three assumptions. A what-if
// can carry its own additional salary and leave its salary's start month empty
// (it then starts with the real salary).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeRepository } from "../../src/data/repo.node.js";

let server: Server;
let baseUrl: string;
let repo: NodeRepository;
const json = (method: string, path: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = async (path: string) => (await fetch(`${baseUrl}${path}`)).json();

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-income-"));
  const { buildApp } = await import("../../server/app.js");
  const { openRepo } = await import("../../server/db/openDb.js");
  repo = openRepo();
  repo.createPlan({ id: "plan-1", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" });
  repo.createWhatIf("plan-1", "w1", "Offer A", "2026-10-15");
  await new Promise<void>((resolve) => { server = buildApp().listen(0, "127.0.0.1", () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("current and additional salary", () => {
  test("none before anything is saved", async () => {
    const s = await get("/api/settings/salary");
    expect(s.currentSalary).toBeNull();
    expect(s.additionalSalary).toBeNull();
  });

  test("round-trips a gross salary and a W-2 additional salary, and leaves the three assumptions alone", async () => {
    const body = {
      currentSalary: { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "2026-11" },
      additionalSalary: { kind: "w2", grossAnnualCents: 5_000_000, fromPeriod: "2027-01" },
    };
    expect((await json("POST", "/api/settings/income", body)).status).toBe(204);
    const s = await get("/api/settings/salary");
    expect(s.currentSalary).toEqual(body.currentSalary);
    expect(s.additionalSalary).toEqual(body.additionalSalary);
    expect(s.premiumMonthlyCents).toBe(0);
  });

  test("saving the three assumptions keeps the salaries", async () => {
    expect((await json("POST", "/api/settings/salary", { premiumMonthlyCents: 50_000, maaserRate: 0.1, children: 1 })).status).toBe(204);
    const s = await get("/api/settings/salary");
    expect(s.currentSalary?.kind).toBe("gross");
    expect(s.additionalSalary?.kind).toBe("w2");
  });

  test("a typed take-home and no additional salary; clearing both", async () => {
    expect((await json("POST", "/api/settings/income", { currentSalary: { kind: "take-home", monthlyCents: 900_000, fromPeriod: "2026-11" }, additionalSalary: null })).status).toBe(204);
    let s = await get("/api/settings/salary");
    expect(s.currentSalary).toEqual({ kind: "take-home", monthlyCents: 900_000, fromPeriod: "2026-11" });
    expect(s.additionalSalary).toBeNull();
    expect((await json("POST", "/api/settings/income", { currentSalary: null, additionalSalary: null })).status).toBe(204);
    s = await get("/api/settings/salary");
    expect(s.currentSalary).toBeNull();
  });

  test("refuses a salary with no start month, or below zero, in words", async () => {
    const r1 = await json("POST", "/api/settings/income", { currentSalary: { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "" }, additionalSalary: null });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toMatch(/month/i);
    const r2 = await json("POST", "/api/settings/income", { currentSalary: null, additionalSalary: { kind: "monthly", monthlyCents: -5, fromPeriod: "2026-11" } });
    expect(r2.status).toBe(400);
  });
});

describe("a what-if's own additional salary and an open start month", () => {
  test("saves a salary with no start month and an additional salary, and reads them back", async () => {
    const w = { scenarioId: "w1", salaryGrossAnnualCents: 12_000_000, salaryFromPeriod: null, changes: [], rows: [], additionalSalary: { kind: "monthly", monthlyCents: 200_000, fromPeriod: "2026-12" } };
    expect((await json("PUT", "/api/scenarios/w1/what-if", w)).status).toBe(204);
    const back = await get("/api/scenarios/w1/what-if");
    expect(back.salaryFromPeriod).toBeNull();
    expect(back.additionalSalary).toEqual(w.additionalSalary);
  });

  test("None is kept apart from Same as Settings", async () => {
    const base = { scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };
    expect((await json("PUT", "/api/scenarios/w1/what-if", { ...base, additionalSalary: "none" })).status).toBe(204);
    expect((await get("/api/scenarios/w1/what-if")).additionalSalary).toBe("none");
    expect((await json("PUT", "/api/scenarios/w1/what-if", { ...base, additionalSalary: null })).status).toBe(204);
    expect((await get("/api/scenarios/w1/what-if")).additionalSalary ?? null).toBeNull();
  });

  test("refuses a bad additional salary", async () => {
    const w = { scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [], additionalSalary: { kind: "w2", grossAnnualCents: 0, fromPeriod: "2026-12" } };
    expect((await json("PUT", "/api/scenarios/w1/what-if", w)).status).toBe(400);
  });
});
