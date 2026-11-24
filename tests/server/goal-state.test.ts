// tests/server/goal-state.test.ts -- POST /api/goals/:id/state:
// Mark complete / unmark, and starting a goal's cost, in one step.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

let server: Server;
let baseUrl: string;
const json = { "Content-Type": "application/json" };
const post = (path: string, body: unknown) => fetch(`${baseUrl}/api${path}`, { method: "POST", headers: json, body: JSON.stringify(body) });
const get = async (path: string) => (await fetch(`${baseUrl}/api${path}`)).json();
const PLAN = "pg";
const goalById = async (id: string) => ((await get("/goals")) as { id: string }[]).find((g) => g.id === id) as Record<string, unknown>;

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-goal-state-test-"));
  const { buildApp } = await import("../../server/app.js");
  await new Promise<void>((resolve) => {
    server = buildApp().listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  expect((await post("/plans", { id: PLAN, name: PLAN, startDate: "2026-01-01", endDate: "2026-12-31" })).status).toBe(200);
  expect((await post("/goals", { id: "ma", name: "Gym", targetAmountCents: 24000, ongoingMonthlyCents: 20000 })).status).toBe(204);
});
afterAll(() => server.close());

describe("POST /goals/:id/state", () => {
  test("Mark complete with Add to budget: the goal is completed and started, and the line is written", async () => {
    const res = await post("/goals/ma/state", { completed: true, startCost: { planId: PLAN, line: "Gym", mode: "new" } });
    expect(res.status).toBe(204);
    const goal = await goalById("ma");
    expect(goal.completedAt).toBeTruthy();
    expect(goal.ongoingStartedPeriod).toMatch(/^\d{4}-\d{2}$/);
    expect(goal.ongoingBudgetLine).toBe("Gym");
    // A new line of $0 every month, plus a goal
    // change adding the cost from the start month on; earlier months are never written.
    const start = goal.ongoingStartedPeriod as string;
    const extras = (await get(`/plans/${PLAN}/budget-extras`)) as { changes: { reason: string; goalId: string; fromMonth: string; amountCents: number }[] };
    expect(extras.changes).toEqual([expect.objectContaining({ reason: "goal", goalId: "ma", fromMonth: start, amountCents: 20000 })]);
    const lines = (await get(`/plans/${PLAN}/budget-lines`)) as { planningCategory: string; period: string | null; amountCents: number }[];
    const mine = lines.filter((l) => l.planningCategory === "Gym");
    expect(mine).toContainEqual(expect.objectContaining({ period: null, amountCents: 0 }));
    expect(mine.find((l) => l.period === start)?.amountCents).toBe(20000);
    expect(mine.every((l) => l.period === null || l.period >= start)).toBe(true);
  });

  test("a refusal writes nothing at all", async () => {
    await post("/goals", { id: "car", name: "Car", targetAmountCents: 100, ongoingMonthlyCents: 50000 });
    const before = await get(`/plans/${PLAN}/budget-lines`);
    const res = await post("/goals/car/state", { completed: true, startCost: { planId: PLAN, line: "Gym", mode: "new" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("There is already a budget line called Gym.");
    expect(await get(`/plans/${PLAN}/budget-lines`)).toEqual(before);
    const car = await goalById("car");
    expect(car.ongoingStartedPeriod).toBeNull();
    expect(car.completedAt).toBeNull(); // the completed mark is part of the same step, so it did not land either
  });

  test("a goal with no ongoing cost, or one already started, cannot start a cost", async () => {
    await post("/goals", { id: "trip", name: "Trip", targetAmountCents: 100 });
    expect((await (await post("/goals/trip/state", { startCost: { planId: PLAN, line: "Trip", mode: "new" } })).json()).error).toBe("This goal has no ongoing cost to start.");
    expect((await (await post("/goals/ma/state", { startCost: { planId: PLAN, line: "Other", mode: "new" } })).json()).error).toBe("This goal's cost is already in your budget.");
  });

  test("unmarking complete leaves the budget line alone", async () => {
    expect((await post("/goals/ma/state", { completed: false })).status).toBe(204);
    expect((await goalById("ma")).completedAt).toBeNull();
    expect(await get(`/plans/${PLAN}/budget-lines`)).toContainEqual(expect.objectContaining({ planningCategory: "Gym", period: null }));
  });

  test("an unknown goal is 404; an unknown plan is refused in plain words", async () => {
    expect((await post("/goals/nope/state", { completed: true })).status).toBe(404);
    await post("/goals", { id: "house", name: "House", targetAmountCents: 100, ongoingMonthlyCents: 250000 });
    expect((await (await post("/goals/house/state", { startCost: { planId: "nope", line: "Housing", mode: "new" } })).json()).error).toBe("That budget plan does not exist.");
  });
});

// The month is the local month shown in the dialog, not the UTC month. Sep 30 at 11:30 pm local is still September.
describe("the start month", () => {
  test("a start late on the last evening of a month records that month", async () => {
    const { setGoalState } = await import("../../server/services/readService.js");
    await post("/goals", { id: "eve", name: "Evening", targetAmountCents: 100, ongoingMonthlyCents: 1000 });
    setGoalState("eve", { startCost: { planId: PLAN, line: "Evening class", mode: "new" } }, new Date(2026, 8, 30, 23, 30));
    expect((await goalById("eve")).ongoingStartedPeriod).toBe("2026-09");
  });
});

// The line keeps its own name whatever capitals were typed.
describe("an existing line typed in other capitals", () => {
  test("is written and recorded under the line's own name", async () => {
    await post("/budget-lines", { planId: PLAN, planningCategory: "Fitness", period: null, amountCents: 5000 });
    await post("/goals", { id: "caps", name: "Caps", targetAmountCents: 100, ongoingMonthlyCents: 1000 });
    expect((await post("/goals/caps/state", { startCost: { planId: PLAN, line: "FITNESS", mode: "existing" } })).status).toBe(204);
    expect((await goalById("caps")).ongoingBudgetLine).toBe("Fitness");
    const lines = (await get(`/plans/${PLAN}/budget-lines`)) as { planningCategory: string }[];
    expect(lines.some((l) => l.planningCategory === "FITNESS")).toBe(false);
  });
  test("a saving line is refused in plain words", async () => {
    await post("/goals", { id: "inv", name: "Inv", targetAmountCents: 100, ongoingMonthlyCents: 1000 });
    const res = await post("/goals/inv/state", { startCost: { planId: PLAN, line: "Investing", mode: "new" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("A goal's cost cannot go on a saving line such as Investing or Retirement. Choose another name or line.");
  });
});

// Once a cost is in the budget, the Budget screen owns it.
describe("changing a started cost", () => {
  const saved = (over: Record<string, unknown> = {}) => ({ id: "ma", name: "Gym", targetAmountCents: 24000, ...over });
  test("a different amount is refused in plain words and nothing changes", async () => {
    const res = await post("/goals", saved({ ongoingMonthlyCents: 25000 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This cost is already in your budget. Change it on the Budget screen.");
    expect((await goalById("ma")).ongoingMonthlyCents).toBe(20000);
  });
  test("clearing it to nothing is a change too", async () => {
    const res = await post("/goals", saved({ ongoingMonthlyCents: 0 }));
    expect(res.status).toBe(400);
    expect((await goalById("ma")).ongoingMonthlyCents).toBe(20000);
  });
  test("the same amount still saves, and so does leaving the field out", async () => {
    expect((await post("/goals", saved({ ongoingMonthlyCents: 20000, notes: "same amount" }))).status).toBe(204);
    expect((await post("/goals", saved({ notes: "field left out" }))).status).toBe(204);
    const g = await goalById("ma");
    expect(g.notes).toBe("field left out");
    expect(g.ongoingMonthlyCents).toBe(20000);
  });
  test("a goal whose cost has not started can still change its cost", async () => {
    expect((await post("/goals", { id: "free", name: "Free", targetAmountCents: 100, ongoingMonthlyCents: 100 })).status).toBe(204);
    expect((await post("/goals", { id: "free", name: "Free", targetAmountCents: 100, ongoingMonthlyCents: 200 })).status).toBe(204);
    expect((await goalById("free")).ongoingMonthlyCents).toBe(200);
  });
});
