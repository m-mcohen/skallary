// tests/server/followups-settings.test.ts
//
// What the server stores:
//   Firm yearly federal income tax and Social Security and Medicare for the
//     current salary, saved with the salary in app_settings; clearing one returns to
//     the estimate. The premium already lives in Settings: a cleared premium returns
//     to the estimate too, and the read says whether it is typed or the estimate.
//   "Name old Zelle payments by the person in the note", off until it is turned on.
//   A what-if's "One-time cost" row (label, amount, month) is stored like a change.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeRepository } from "../../src/data/repo.node.js";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary.js";

let server: Server;
let baseUrl: string;
let repo: NodeRepository;
const json = (method: string, path: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = async (path: string) => (await fetch(`${baseUrl}${path}`)).json();

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-followups-"));
  const { buildApp } = await import("../../server/app.js");
  const { openRepo } = await import("../../server/db/openDb.js");
  repo = openRepo();
  repo.createPlan({ id: "plan-1", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" });
  repo.createWhatIf("plan-1", "w1", "Offer A", "2026-10-15");
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("the old Zelle naming switch", () => {
  test("off until it is turned on, and it stays as set", async () => {
    expect(await get("/api/settings/zelle-names")).toEqual({ on: false });
    expect((await json("POST", "/api/settings/zelle-names", { on: true })).status).toBe(204);
    expect(await get("/api/settings/zelle-names")).toEqual({ on: true });
    expect((await json("POST", "/api/settings/zelle-names", { on: false })).status).toBe(204);
    expect(await get("/api/settings/zelle-names")).toEqual({ on: false });
  });

  test("anything but true or false is refused in plain words", async () => {
    const res = await json("POST", "/api/settings/zelle-names", { on: "yes" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/on or off/);
  });
});

describe("firm tax figures and the premium", () => {
  const salary = { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "2026-11" };

  test("none before anything is typed: taxes are estimated, and so is a premium never saved", async () => {
    const s = await get("/api/settings/salary");
    expect(s.firmTaxes).toBeNull();
    expect(s.premiumFromSettings).toBe(false);
    expect(s.premiumMonthlyCents).toBe(DEFAULT_SALARY_ASSUMPTIONS.premiumMonthlyCents);
  });

  test("firm yearly figures are saved with the salary and read back", async () => {
    const res = await json("POST", "/api/settings/income", {
      currentSalary: salary,
      additionalSalary: null,
      firmTaxes: { federalAnnualCents: 1_200_000, payrollAnnualCents: 1_100_000 },
    });
    expect(res.status).toBe(204);
    const s = await get("/api/settings/salary");
    expect(s.firmTaxes).toEqual({ federalAnnualCents: 1_200_000, payrollAnnualCents: 1_100_000 });
  });

  test("clearing one returns it to the estimate; the other stays", async () => {
    await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, firmTaxes: { federalAnnualCents: null, payrollAnnualCents: 1_100_000 } });
    expect((await get("/api/settings/salary")).firmTaxes).toEqual({ federalAnnualCents: null, payrollAnnualCents: 1_100_000 });
    await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, firmTaxes: null });
    expect((await get("/api/settings/salary")).firmTaxes).toBeNull();
  });

  test("a save that does not mention firm figures leaves them as they were", async () => {
    await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, firmTaxes: { federalAnnualCents: 1_000_000, payrollAnnualCents: null } });
    await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null });
    expect((await get("/api/settings/salary")).firmTaxes).toEqual({ federalAnnualCents: 1_000_000, payrollAnnualCents: null });
  });

  test("a figure below zero is refused in plain words", async () => {
    const res = await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, firmTaxes: { federalAnnualCents: -5, payrollAnnualCents: null } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cannot be below zero/);
  });

  test("a typed premium reads as typed; a cleared one returns to the estimate", async () => {
    await json("POST", "/api/settings/salary", { premiumMonthlyCents: 65_000, maaserRate: 0.1, children: 1 });
    let s = await get("/api/settings/salary");
    expect([s.premiumMonthlyCents, s.premiumFromSettings]).toEqual([65_000, true]);
    await json("POST", "/api/settings/salary", { premiumMonthlyCents: null, maaserRate: 0.1, children: 1 });
    s = await get("/api/settings/salary");
    expect([s.premiumMonthlyCents, s.premiumFromSettings]).toEqual([DEFAULT_SALARY_ASSUMPTIONS.premiumMonthlyCents, false]);
  });
});

describe("a one-time cost row", () => {
  test("stored and read back with its month, on the list, switchable", async () => {
    const w = {
      scenarioId: "w1",
      salaryGrossAnnualCents: null,
      salaryFromPeriod: null,
      changes: [{ id: "c1", position: 1, kind: "one-time", label: "Renovation", planningCategory: "One-time cost", amountCents: 1_500_000, fromPeriod: "2027-03", untilPeriod: "2027-03", loan: null }],
      rows: [{ kind: "change", refId: "c1", position: 1, on: false }],
    };
    const res = await json("PUT", "/api/scenarios/w1/what-if", w);
    expect(res.status).toBe(204);
    const back = await get("/api/scenarios/w1/what-if");
    expect(back.changes[0]).toMatchObject({ kind: "one-time", label: "Renovation", amountCents: 1_500_000, fromPeriod: "2027-03" });
    expect(back.rows).toEqual([{ kind: "change", refId: "c1", position: 1, on: false }]);
  });

  test("a one-time cost needs its month", async () => {
    const res = await json("PUT", "/api/scenarios/w1/what-if", {
      scenarioId: "w1",
      salaryGrossAnnualCents: null,
      salaryFromPeriod: null,
      changes: [{ id: "c1", position: 1, kind: "one-time", label: "Renovation", planningCategory: "One-time cost", amountCents: 1_500_000, fromPeriod: "", untilPeriod: null, loan: null }],
      rows: [],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/month it is paid/);
  });
});
