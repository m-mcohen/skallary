// tests/server/what-if.test.ts
// The what-if routes on tests/server/mutations.test.ts's harness:
// a temp DB under a fresh LOCALAPPDATA, buildApp(), listen(0), plain fetch.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WhatIf, WhatIfChange } from "../../src/domain/what-if.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-what-if-test-"));
  const { buildApp } = await import("../../server/app.js");
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

const json = { "Content-Type": "application/json" };

async function seed(planId: string, scenarioId: string): Promise<void> {
  expect((await fetch(`${baseUrl}/api/plans`, { method: "POST", headers: json, body: JSON.stringify({ id: planId, name: planId, startDate: "2026-01-01", endDate: "2026-12-31" }) })).status).toBe(200);
  const s = { id: scenarioId, planId, name: "Offer A $120k base", isDefault: false, income: { kind: "plan" }, expenseDeltas: [], createdAt: "2026-09-15" };
  expect((await fetch(`${baseUrl}/api/scenarios`, { method: "POST", headers: json, body: JSON.stringify(s) })).status).toBe(204);
}

const car: WhatIfChange = {
  id: "c1", position: 1, kind: "car", label: "New car", planningCategory: "Car payment", amountCents: 70_000, fromPeriod: "2027-03", untilPeriod: null,
  loan: { priceCents: 3_500_000, downPaymentCents: 500_000, annualRate: 0.065, years: 5 },
};
const body = (scenarioId: string, changes: WhatIfChange[] = [car]): WhatIf => ({
  scenarioId, salaryGrossAnnualCents: 12_000_000, salaryFromPeriod: "2026-11", changes, rows: [{ kind: "goal-saving", refId: "g-house", position: 1, on: true }],
});
const put = (id: string, w: unknown) => fetch(`${baseUrl}/api/scenarios/${id}/what-if`, { method: "PUT", headers: json, body: JSON.stringify(w) });

async function refused(w: WhatIf, message: string): Promise<void> {
  const res = await put(w.scenarioId, w);
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toContain(message);
}

describe("POST /plans/:planId/what-ifs -- one step", () => {
  test("writes the scenario row and its empty what-if together, and the plan's list carries it", async () => {
    expect((await fetch(`${baseUrl}/api/plans`, { method: "POST", headers: json, body: JSON.stringify({ id: "p5", name: "p5", startDate: "2026-01-01", endDate: "2026-12-31" }) })).status).toBe(200);
    const res = await fetch(`${baseUrl}/api/plans/p5/what-ifs`, { method: "POST", headers: json, body: JSON.stringify({ id: "w5", name: "Offer A $120k" }) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ scenarioId: "w5", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] });
    expect(await (await fetch(`${baseUrl}/api/scenarios/w5`)).json()).toMatchObject({ id: "w5", planId: "p5", name: "Offer A $120k" });
    const list = (await (await fetch(`${baseUrl}/api/plans/p5/what-ifs`)).json()) as WhatIf[];
    expect(list.map((w) => w.scenarioId)).toEqual(["w5"]);
  });

  test("a blank name is refused, and nothing is written", async () => {
    expect((await fetch(`${baseUrl}/api/plans`, { method: "POST", headers: json, body: JSON.stringify({ id: "p6", name: "p6", startDate: "2026-01-01", endDate: "2026-12-31" }) })).status).toBe(200);
    const res = await fetch(`${baseUrl}/api/plans/p6/what-ifs`, { method: "POST", headers: json, body: JSON.stringify({ id: "w6", name: "   " }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Give the what-if a name.");
    expect((await fetch(`${baseUrl}/api/scenarios/w6/what-if`)).status).toBe(404);
    expect(await (await fetch(`${baseUrl}/api/scenarios/w6`)).json()).toBeNull(); // nothing written
  });
});

describe("what-if routes", () => {
  test("PUT then GET returns the same what-if; the plan's list carries it", async () => {
    await seed("p1", "w1");
    expect((await put("w1", body("w1"))).status).toBe(204);
    const res = await fetch(`${baseUrl}/api/scenarios/w1/what-if`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body("w1"));
    const list = (await (await fetch(`${baseUrl}/api/plans/p1/what-ifs`)).json()) as WhatIf[];
    expect(list.map((w) => w.scenarioId)).toEqual(["w1"]);
  });

  test("GET on a scenario with no what-if is 404; PUT on a missing scenario is 404", async () => {
    await seed("p2", "w2");
    expect((await fetch(`${baseUrl}/api/scenarios/w2/what-if`)).status).toBe(404);
    expect((await put("nope", body("nope"))).status).toBe(404);
  });

  test("the body's scenario must be the one in the address", async () => {
    await seed("p3", "w3");
    expect((await put("w3", body("someone-else"))).status).toBe(400);
  });

  test("impossible changes are refused in plain words, and nothing is saved", async () => {
    await seed("p4", "w4");
    await refused(body("w4", [{ ...car, untilPeriod: "2027-01" }]), "The end month is before the start month.");
    await refused(body("w4", [{ ...car, loan: { ...car.loan!, years: 0 } }]), "A loan needs at least one year.");
    await refused(body("w4", [{ ...car, loan: { ...car.loan!, downPaymentCents: 9_999_999 } }]), "The down payment is more than the price.");
    await refused(body("w4", [{ ...car, loan: { ...car.loan!, annualRate: -0.01 } }]), "The rate cannot be below zero.");
    await refused(body("w4", [{ ...car, kind: "add", loan: null, amountCents: -5 }]), "A cost cannot be below zero.");
    await refused(body("w4", [{ ...car, fromPeriod: "March" }]), "Pick a start month.");
    await refused(body("w4", [{ ...car, label: "  " }]), "Give the change a name.");
    await refused(body("w4", [{ ...car, planningCategory: "" }]), "Pick a budget line.");
    // An empty start month is allowed (it starts with the current salary); a bad one is not.
    await refused({ ...body("w4"), salaryGrossAnnualCents: 12_000_000, salaryFromPeriod: "Nov" }, "Pick the month the salary starts, or leave it empty.");
    await refused(body("w4", [{ ...car, kind: "add", loan: null, planningCategory: "Income" }]), "Income is not a cost. A what-if's salary goes in Income while this is on.");
    // The change kind, loan fields, goal picks and a
    // repeated change id are all checked before anything is written.
    await refused(body("w4", [{ ...car, kind: "not-a-real-kind" }]), "That kind of change is not recognized.");
    await refused(body("w4", [{ ...car, loan: { ...car.loan!, priceCents: undefined } }]), "A loan needs a price.");
    await refused(body("w4", [car, { ...car, id: "c1" }]), "Two changes share the same id."); // c1 repeated
    await refused({ ...body("w4"), rows: [{ kind: "goal-saving", refId: "", position: 1, on: true }] }, "A row needs the change or goal it points to.");
    await refused({ ...body("w4"), rows: [{ kind: "goal-saving", refId: "g-house", position: 1.5, on: true }] }, "A row's order must be a whole number.");
    await refused({ ...body("w4"), rows: undefined }, "A what-if needs its list of changes and rows.");
    expect((await fetch(`${baseUrl}/api/scenarios/w4/what-if`)).status).toBe(404);
  });
});
