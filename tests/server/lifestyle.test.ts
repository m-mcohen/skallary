// tests/server/lifestyle.test.ts
// Routes for salary assumptions. The scenario line-override routes
// (PUT/DELETE /api/scenarios/:id/lines...) this file used to also cover left
// with the Scenarios and Lifestyle screens -- no screen
// calls them any more, so routes.ts no longer wires them up. The repository
// and overlay engine underneath are unchanged and still covered at that
// layer by tests/data/line-overrides.test.ts.
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
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-lifestyle-"));
  const { buildApp } = await import("../../server/app.js");
  const { openRepo } = await import("../../server/db/openDb.js");
  repo = openRepo();
  repo.createPlan({ id: "plan-1", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" });
  repo.upsertScenario({ id: "planned", planId: "plan-1", name: "Planned life", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "" });
  await new Promise<void>((resolve) => { server = buildApp().listen(0, "127.0.0.1", () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("salary settings", () => {
  test("defaults before anything is saved", async () => {
    // The current and additional salary come back beside the assumptions.
    // Nothing is assumed: no premium, no rate, no children, and no tax profile (the screens show
    // the set-this-up card). No firm tax figure, pay schedule, paycheck figures or benefits list yet.
    expect(await get("/api/settings/salary")).toEqual({ premiumMonthlyCents: 0, premiumFromSettings: false, afterTaxBenefitsMonthlyCents: 0, benefits: null, firmTaxes: null, paySchedule: null, paycheck: null, maaserRate: 0, children: 0, tax: { filingStatus: null, children: null }, currentSalary: null, additionalSalary: null, pot: null });
  });
  test("round-trips a change", async () => {
    expect((await json("POST", "/api/settings/salary", { premiumMonthlyCents: 50_000, maaserRate: 0.1, children: 2 })).status).toBe(204);
    expect(await get("/api/settings/salary")).toEqual({ premiumMonthlyCents: 50_000, premiumFromSettings: true, afterTaxBenefitsMonthlyCents: 0, benefits: null, firmTaxes: null, paySchedule: null, paycheck: null, maaserRate: 0, children: 2, tax: { filingStatus: null, children: 2 }, currentSalary: null, additionalSalary: null, pot: null });
  });
  test("rejects a negative premium and a fractional child count", async () => {
    expect((await json("POST", "/api/settings/salary", { premiumMonthlyCents: -1, maaserRate: 0.1, children: 1 })).status).toBe(400);
    expect((await json("POST", "/api/settings/salary", { premiumMonthlyCents: 0, maaserRate: 0.1, children: 1.5 })).status).toBe(400);
  });
});
