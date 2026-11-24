// tests/server/benefits-settings.test.ts
//
// Benefits: what the server stores and reads, through the real app on a
// temporary database:
//   - with no list saved, the older premium reads exactly as before (one monthly
//     figure), and no list is reported;
//   - a list saved with Save salary (POST /api/settings/income, `benefits`) is read back as
//     typed, and its total a month becomes the premium every screen reads; the after-tax
//     part is reported apart;
//   - a row typed a paycheck is turned into a month by the pay schedule in force;
//   - a bad list is refused in plain words and nothing is stored; a save that leaves the
//     list out leaves it as it is; null clears it, and the older premium reads again.
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
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-benefits-"));
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
// Illustrative figures.
const list = [
  { name: "Health insurance", amountCents: 50_000, every: "month", beforeTax: true },
  { name: "HSA", amountCents: 40_000, every: "month", beforeTax: true },
  { name: "Life insurance", amountCents: 2_500, every: "month", beforeTax: false },
];

describe("benefits under Settings, Salary", () => {
  test("no list: the older monthly premium reads exactly as before", async () => {
    expect((await json("POST", "/api/settings/salary", { premiumMonthlyCents: 92_500, maaserRate: 0.1, children: 1 })).status).toBe(204);
    const s = await get("/api/settings/salary");
    expect([s.premiumMonthlyCents, s.premiumFromSettings, s.benefits ?? null, s.afterTaxBenefitsMonthlyCents ?? 0]).toEqual([92_500, true, null, 0]);
  });

  test("a saved list reads back as typed; its total is the premium, and the after-tax part is apart", async () => {
    const res = await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, benefits: list });
    expect(res.status).toBe(204);
    const s = await get("/api/settings/salary");
    expect(s.benefits).toEqual(list);
    expect([s.premiumMonthlyCents, s.premiumFromSettings, s.afterTaxBenefitsMonthlyCents]).toEqual([92_500, true, 2_500]);
    // The older figure is left in place, so clearing the list brings it back.
    expect(repo.getSetting("salary_premium_monthly_cents")).toBe("92500");
  });

  test("a row typed a paycheck is a month by the pay schedule in force", async () => {
    const paycheckRow = [{ name: "Dental", amountCents: 1_000, every: "paycheck", beforeTax: true }];
    expect((await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paySchedule: "twice-a-month", benefits: paycheckRow })).status).toBe(204);
    const s = await get("/api/settings/salary");
    expect(s.premiumMonthlyCents).toBe(2_000);
  });

  test("a bad list is refused in plain words, and nothing is stored", async () => {
    const before = repo.getSetting("salary_benefits");
    const res = await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, benefits: [{ name: "", amountCents: 100, every: "month", beforeTax: true }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Give each benefit a name.");
    expect(repo.getSetting("salary_benefits")).toBe(before);
  });

  test("a row typed a paycheck with no pay schedule is refused", async () => {
    expect((await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, paySchedule: null, benefits: [{ name: "Dental", amountCents: 1_000, every: "paycheck", beforeTax: true }] })).status).toBe(400);
  });

  test("a save that leaves the list out leaves it; null clears it and the older premium reads again", async () => {
    expect((await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, benefits: list })).status).toBe(204);
    expect((await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null })).status).toBe(204);
    expect((await get("/api/settings/salary")).benefits).toEqual(list);
    expect((await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, benefits: null })).status).toBe(204);
    const s = await get("/api/settings/salary");
    expect([s.benefits ?? null, s.premiumMonthlyCents, s.afterTaxBenefitsMonthlyCents ?? 0]).toEqual([null, 92_500, 0]);
  });

  test("an empty list is no benefits: $0.00 a month, typed", async () => {
    expect((await json("POST", "/api/settings/income", { currentSalary: salary, additionalSalary: null, benefits: [] })).status).toBe(204);
    const s = await get("/api/settings/salary");
    expect([s.benefits, s.premiumMonthlyCents, s.premiumFromSettings]).toEqual([[], 0, true]);
  });
});
