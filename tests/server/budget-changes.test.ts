import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeRepository } from "../../src/data/repo.node.js";
import type { NormalizedTxn } from "../../src/domain/types.js";

let server: Server;
let baseUrl: string;
let repo: NodeRepository;
let svc: typeof import("../../server/services/budgetChangeService.js");
const P = "plan-2026";
const send = (method: string, path: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "fin-budget-changes-"));
  const { buildApp } = await import("../../server/app.js");
  const { openRepo } = await import("../../server/db/openDb.js");
  repo = openRepo();
  svc = await import("../../server/services/budgetChangeService.js");
  repo.createPlan({ id: P, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" });
  repo.setBudgetLine({ planId: P, planningCategory: "Groceries", period: null, amountCents: 80000 });
  const txns: NormalizedTxn[] = ["2026-07-05", "2026-08-05", "2026-09-05"].map((date, i) => ({
    sourceTransactionId: `g-${i}`, accountId: "acc-1", date, amountCents: -90000, sourceCategory: "Groceries",
    merchant: "Target", isTransfer: false, sourceUpdatedAt: null,
  }));
  repo.upsertTransactions(txns);
  await new Promise<void>((resolve) => { server = buildApp().listen(0, "127.0.0.1", () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("changing a line", () => {
  test("from a month on is read back as the amount in force, past the plan's end too", async () => {
    const s = svc.budgetChangeService(() => new Date(2026, 9, 6, 20, 0));
    s.changeLine(P, "Groceries", { fromMonth: "2026-10", amountCents: 90000 });
    const lines = (await (await fetch(`${baseUrl}/plans/${P}/budget-lines`)).json()) as { period: string | null; amountCents: number; planningCategory: string }[];
    const at = (m: string) => lines.find((l) => l.planningCategory === "Groceries" && l.period === m)?.amountCents;
    expect(at("2026-10")).toBe(90000);
    expect(at("2027-01")).toBe(90000);
    expect(at("2026-09")).toBeUndefined();
  });

  test("a month before the current local month is refused", () => {
    const s = svc.budgetChangeService(() => new Date(2026, 8, 30, 21, 0));
    expect(() => s.changeLine(P, "Groceries", { fromMonth: "2026-08", amountCents: 1 })).toThrow("Months before this month are locked.");
    expect(() => s.changeLine(P, "Groceries", { fromMonth: "2026-09", amountCents: 1 })).not.toThrow();
  });

  test("a month outside the plan, a bad amount or a bad month is refused", () => {
    const s = svc.budgetChangeService(() => new Date(2026, 9, 6));
    expect(() => s.changeLine(P, "Groceries", { fromMonth: "2027-01", amountCents: 1 })).toThrow("That month is not in this budget.");
    // Refunds may be negative, but budget amounts must be whole cents.
    expect(() => s.changeLine(P, "Groceries", { fromMonth: "2026-11", amountCents: 0.5 })).toThrow("Enter an amount in whole cents.");
    expect(() => s.changeLine(P, "Groceries", { fromMonth: "2026-13", amountCents: 1 })).toThrow("Pick a month.");
  });

  test("setting every month lists the changes it replaced", async () => {
    const res = await send("POST", `/plans/${P}/lines/Groceries/change`, { fromMonth: null, amountCents: 85000 });
    const body = (await res.json()) as { replaced: { fromMonth: string }[] };
    expect(body.replaced.length).toBeGreaterThan(0);
    expect(repo.listBudgetChanges(P).filter((c) => c.reason === "changed")).toEqual([]);
  });

  test("go back to suggested returns to today's average, lists cleared changes and keeps a goal's", async () => {
    repo.changeLineFrom(P, "Groceries", "2026-11", 99000);
    repo.addGoalChange(P, "Groceries", "2026-03", 2000, "goal-x");
    const res = await send("POST", `/plans/${P}/lines/Groceries/reset`);
    const body = (await res.json()) as { cleared: unknown[]; kept: unknown[]; suggestion: { amountCents: number } };
    expect(body.cleared).toHaveLength(1);
    expect(body.kept).toHaveLength(1);
    expect(body.suggestion.amountCents).toBeGreaterThan(0);
    expect(repo.getBudgetLines(P).find((l) => l.period === null && l.planningCategory === "Groceries")?.source).toBe("suggested");
  });
});

describe("big months and notes", () => {
  test("a big month is added, listed in extras, and refused before this month", async () => {
    const s = svc.budgetChangeService(() => new Date(2026, 9, 6));
    const b = s.addBigMonth(P, { planningCategory: "Gifts", month: "2026-12", label: "Holiday gifts", amountCents: 80000 });
    expect(s.extras(P).bigMonths).toEqual([b]);
    expect(() => s.addBigMonth(P, { planningCategory: "Gifts", month: "2026-09", label: "x", amountCents: 1 })).toThrow("Months before this month are locked.");
    expect(() => s.addBigMonth(P, { planningCategory: "Gifts", month: "2026-12", label: "  ", amountCents: 1 })).toThrow("Name the big month.");
  });

  test("a note is saved through the route", async () => {
    const res = await send("PUT", `/plans/${P}/month-notes`, { planningCategory: "Gifts", month: "2026-12", note: "Holiday party" });
    expect(res.status).toBe(204);
    expect(repo.listMonthNotes(P)[0].note).toBe("Holiday party");
  });

  test("an every-month amount typed in the grid is marked as user-entered", async () => {
    await send("POST", "/budget-lines", { planId: P, planningCategory: "Dining Out", period: null, amountCents: 30000 });
    expect(repo.getBudgetLines(P).find((l) => l.planningCategory === "Dining Out")?.source).toBe("you");
  });
});

// Refund lines may be budgeted below zero.
// A big-month amount must still be nonnegative.
test("a refund line can be changed to a negative amount; a big month cannot be negative", () => {
  const s = svc.budgetChangeService(() => new Date(2026, 9, 6, 20, 0));
  s.changeLine(P, "Returns", { fromMonth: null, amountCents: -15000 });
  expect(repo.getBudgetLines(P).find((l) => l.planningCategory === "Returns" && l.period === null)?.amountCents).toBe(-15000);
  expect(() => s.changeLine(P, "Returns", { fromMonth: null, amountCents: 1.5 })).toThrow("Enter an amount in whole cents.");
  expect(() => s.addBigMonth(P, { planningCategory: "Gifts", month: "2026-12", label: "Bad", amountCents: -100 })).toThrow("Enter an amount of zero or more.");
});

// The Paychecks line reads salary settings instead of a stored budget change.
test("Paychecks cannot be changed: it reads Settings, Salary", () => {
  const s = svc.budgetChangeService(() => new Date(2026, 9, 6, 20, 0));
  expect(() => s.changeLine(P, "Paychecks", { fromMonth: null, amountCents: 500000 })).toThrow("Paychecks reads its budget from Settings, Salary.");
});

// Check the same editing limits through the service.
describe("the server repeats the screens' rules", () => {
  const s = () => svc.budgetChangeService(() => new Date(2026, 9, 6, 20, 0));

  test("a note is 200 characters at most", () => {
    expect(() => s().setNote(P, { planningCategory: "Gifts", month: "2026-12", note: "x".repeat(201) })).toThrow("A note is 200 characters at most.");
    s().setNote(P, { planningCategory: "Gifts", month: "2026-12", note: "x".repeat(200) });
    expect(repo.listMonthNotes(P).find((n) => n.planningCategory === "Gifts")?.note).toHaveLength(200);
  });

  test("a big month goes on a spending line only", () => {
    expect(() => s().addBigMonth(P, { planningCategory: "Business Income", month: "2026-12", label: "Bonus", amountCents: 1000 })).toThrow(
      "A big month goes on a spending line.",
    );
  });

  test("a budget whose year is over is not changed or sent back to suggested", () => {
    repo.createPlan({ id: "plan-2025", name: "2025", startDate: "2025-01-01", endDate: "2025-12-31" });
    repo.setBudgetLine({ planId: "plan-2025", planningCategory: "Groceries", period: null, amountCents: 1000 });
    const before = JSON.stringify(repo.getBudgetLines("plan-2025"));
    const over = "That budget's year is over. Start the new year's budget instead.";
    expect(() => s().changeLine("plan-2025", "Groceries", { fromMonth: null, amountCents: 2000 })).toThrow(over);
    expect(() => s().resetLine("plan-2025", "Groceries")).toThrow(over);
    expect(JSON.stringify(repo.getBudgetLines("plan-2025"))).toBe(before);
  });

  test("a big month in a finished month is not edited or deleted", () => {
    const b = s().addBigMonth(P, { planningCategory: "Gifts", month: "2026-11", label: "Birthday", amountCents: 5000 });
    const december = svc.budgetChangeService(() => new Date(2026, 11, 2, 9, 0));
    expect(() => december.deleteBigMonth(b.id)).toThrow("Months before this month are locked.");
    expect(() => december.updateBigMonth(b.id, { planningCategory: "Gifts", month: "2026-12", label: "Birthday", amountCents: 1 })).toThrow(
      "Months before this month are locked.",
    );
    expect(repo.getBigMonth(b.id)).toMatchObject({ month: "2026-11", amountCents: 5000 });
    s().deleteBigMonth(b.id);
    expect(repo.getBigMonth(b.id)).toBeFalsy();
  });
});
