// tests/server/paycheck-settings.test.ts
//
// What the server stores and reads, through
// the real app on a temporary database:
//   - a pay schedule (weekly, every two weeks, twice a month, monthly) and the three paycheck
//     figures (federal income tax, Social Security and Medicare, health premium), saved with
//     Save salary on POST /api/settings/income and read back on GET /api/settings/salary;
//   - the read converts them: the taxes into the yearly firm figures, the premium into the
//     monthly premium, so every screen downstream works as before;
//   - an older premium typed A MONTH ($650.00, say) and any older yearly tax figure
//     read exactly as before until the paycheck figure that replaces it;
//   - a figure with no schedule, an unknown schedule and a figure below zero are refused;
//     a save that omits them leaves them.
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
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-paycheck-"));
  const { buildApp } = await import("../../server/app.js");
  const { openRepo } = await import("../../server/db/openDb.js");
  repo = openRepo();
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const salary = { kind: "gross", grossAnnualCents: 12_000_000, fromPeriod: "2026-11" };
const none = { federalCents: null, payrollCents: null, premiumCents: null };

describe("the pay schedule and paycheck figures", () => {
  test("none before anything is typed: no schedule, no paycheck figures, everything estimated", async () => {
    const s = await get("/api/settings/salary");
    expect(s.paySchedule).toBeNull();
    expect(s.paycheck).toBeNull();
    expect(s.firmTaxes).toBeNull();
    expect([s.premiumMonthlyCents, s.premiumFromSettings]).toEqual([DEFAULT_SALARY_ASSUMPTIONS.premiumMonthlyCents, false]);
  });

  test("a premium typed as $650.00 a month reads $650.00 a month, and picking a schedule moves nothing", async () => {
    // The older screen saved the premium as a monthly amount under its own key.
    expect((await json("POST", "/api/settings/salary", { premiumMonthlyCents: 65_000, maaserRate: 0.1, children: 1 })).status).toBe(204);
    let s = await get("/api/settings/salary");
    expect([s.premiumMonthlyCents, s.premiumFromSettings, s.paySchedule, s.firmTaxes]).toEqual([65_000, true, null, null]);
    expect((await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paySchedule: "every-two-weeks", paycheck: none })).status).toBe(204);
    s = await get("/api/settings/salary");
    expect([s.premiumMonthlyCents, s.premiumFromSettings, s.paySchedule, s.firmTaxes]).toEqual([65_000, true, "every-two-weeks", null]);
    expect(s.paycheck).toBeNull(); // no figure typed: stored empty
  });

  test("the Save on Salary assumptions, which no longer sends a premium, leaves the older $650.00 a month as it is", async () => {
    expect((await json("POST", "/api/settings/salary", { maaserRate: 0.1, children: 1 })).status).toBe(204);
    const s = await get("/api/settings/salary");
    expect([s.premiumMonthlyCents, s.premiumFromSettings]).toEqual([65_000, true]);
    expect(repo.getSetting("salary_premium_monthly_cents")).toBe("65000");
  });

  test("a figure with no schedule, an unknown schedule and a figure below zero are refused in plain words", async () => {
    let res = await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paySchedule: null, paycheck: { ...none, premiumCents: 31_000 } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Pick how often you are paid before typing paycheck figures.");
    res = await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paySchedule: "fortnightly", paycheck: none });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("That pay schedule is not recognized.");
    res = await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paySchedule: "weekly", paycheck: { ...none, federalCents: -100 } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("A paycheck figure cannot be below zero.");
    // Nothing refused was stored.
    expect((await get("/api/settings/salary")).paySchedule).toBe("every-two-weeks");
  });

  test("typed paycheck figures are converted: taxes a year, the premium a month; the older monthly premium is replaced", async () => {
    // Every two weeks (26 paychecks):
    //   federal $800.00 x 26 = $20,800.00 a year;
    //   Social Security and Medicare $600.00 x 26 = $15,600.00 a year;
    //   premium $310.00 x 26 = $8,060.00 a year; / 12 = 67,166.67 cents, rounds to $671.67 a month.
    const paycheck = { federalCents: 80_000, payrollCents: 60_000, premiumCents: 31_000 };
    expect((await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paySchedule: "every-two-weeks", paycheck })).status).toBe(204);
    const s = await get("/api/settings/salary");
    expect(s.paycheck).toEqual(paycheck);
    expect(s.firmTaxes).toEqual({ federalAnnualCents: 2_080_000, payrollAnnualCents: 1_560_000 });
    expect([s.premiumMonthlyCents, s.premiumFromSettings]).toEqual([67_167, true]);
    // The paycheck figure replaced the older monthly one, so clearing it later means the estimate.
    expect(repo.getSetting("salary_premium_monthly_cents")).toBe("");
  });

  test("a save that omits them leaves them: Save salary without them, and the assumptions' Save", async () => {
    expect((await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null })).status).toBe(204);
    expect((await json("POST", "/api/settings/salary", { maaserRate: 0.1, children: 2 })).status).toBe(204);
    const s = await get("/api/settings/salary");
    expect(s.paySchedule).toBe("every-two-weeks");
    expect(s.paycheck).toEqual({ federalCents: 80_000, payrollCents: 60_000, premiumCents: 31_000 });
    expect([s.premiumMonthlyCents, s.children]).toEqual([67_167, 2]);
  });

  test("a new schedule converts the same paycheck figures again", async () => {
    // Twice a month (24): federal $800.00 x 24 = $19,200.00 a year; premium $310.00 x 24 = $7,440.00 a year = $620.00 a month.
    expect((await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paySchedule: "twice-a-month" })).status).toBe(204);
    const s = await get("/api/settings/salary");
    expect(s.firmTaxes.federalAnnualCents).toBe(1_920_000);
    expect(s.premiumMonthlyCents).toBe(62_000);
  });

  test("the schedule cannot be taken away while paycheck figures stand", async () => {
    const res = await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paySchedule: null });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Pick how often you are paid before typing paycheck figures.");
  });

  test("a blank paycheck figure is estimated again", async () => {
    expect((await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paySchedule: "twice-a-month", paycheck: none })).status).toBe(204);
    const s = await get("/api/settings/salary");
    expect(s.firmTaxes).toBeNull();
    expect([s.premiumMonthlyCents, s.premiumFromSettings]).toEqual([DEFAULT_SALARY_ASSUMPTIONS.premiumMonthlyCents, false]);
  });

  test("state and local taxes typed from a pay stub are stored and read as a year; blank again means none", async () => {
    // Twice a month (24): $100.00 x 24 = $2,400.00 a year, with both federal figures left to the estimate.
    expect((await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paySchedule: "twice-a-month", paycheck: { ...none, otherTaxesCents: 10_000 } })).status).toBe(204);
    const s = await get("/api/settings/salary");
    expect(s.paycheck.otherTaxesCents).toBe(10_000);
    expect(s.firmTaxes).toEqual({ federalAnnualCents: null, payrollAnnualCents: null, otherAnnualCents: 240_000 });
    expect((await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paySchedule: "twice-a-month", paycheck: none })).status).toBe(204);
    expect((await get("/api/settings/salary")).firmTaxes).toBeNull();
  });

  test("an older yearly tax figure reads as before until the paycheck figure replaces it", async () => {
    // The older screen saved yearly figures with the salary.
    await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, firmTaxes: { federalAnnualCents: 1_200_000, payrollAnnualCents: 1_100_000 } });
    expect((await get("/api/settings/salary")).firmTaxes).toEqual({ federalAnnualCents: 1_200_000, payrollAnnualCents: 1_100_000 });
    // Federal typed a paycheck: $800.00 x 24 = $19,200.00 a year; Social Security and Medicare keeps the older $11,000.00.
    await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paySchedule: "twice-a-month", paycheck: { ...none, federalCents: 80_000 } });
    expect((await get("/api/settings/salary")).firmTaxes).toEqual({ federalAnnualCents: 1_920_000, payrollAnnualCents: 1_100_000 });
    // Clearing the paycheck federal figure now means the estimate, not the older yearly one.
    await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paycheck: none });
    expect((await get("/api/settings/salary")).firmTaxes).toEqual({ federalAnnualCents: null, payrollAnnualCents: 1_100_000 });
  });
});
