import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NodeRepository } from "../../src/data/repo.node.js";
import type { NormalizedTxn } from "../../src/domain/types.js";
import { lineBudget } from "../../src/domain/budget-income.js";
import { expandChanges } from "../../src/domain/budget-changes.js";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary.js";

const clock = () => new Date(2027, 1, 10, 12);
const HOME = { planningCategory: "Insurance", label: "Home policy", payeeKey: "acme insurance", accountId: null, amountCents: 60_001, months: ["03"], takeOutOfLine: true };
const first = "plan-2027";
const next = "plan-2028";
let folder: string;
let repo: NodeRepository;
let bills: typeof import("../../server/services/yearlyCostsService.js").yearlyCostsService;
let budgets: typeof import("../../server/services/budgetChangeService.js").budgetChangeService;
let store: ReturnType<typeof import("../../server/repositories/yearlyCostsRepository.js").yearlyCostsRepository>;

function charge(id: string, date: string, merchant: string, amount: number): NormalizedTxn {
  return { sourceTransactionId: id, accountId: "toy-checking", date, amountCents: -amount, merchant, payee: merchant,
    sourceCategory: "Insurance", isTransfer: false, sourceUpdatedAt: null };
}

beforeEach(async () => {
  vi.resetModules();
  folder = mkdtempSync(join(tmpdir(), "toy-yearly-bills-"));
  vi.stubEnv("LOCALAPPDATA", folder);
  const { openRepo } = await import("../../server/db/openDb.js");
  repo = openRepo();
  bills = (await import("../../server/services/yearlyCostsService.js")).yearlyCostsService;
  budgets = (await import("../../server/services/budgetChangeService.js")).budgetChangeService;
  store = (await import("../../server/repositories/yearlyCostsRepository.js")).yearlyCostsRepository();
  for (const year of [2027, 2028]) {
    const planId = `plan-${year}`;
    repo.createPlan({ id: planId, name: String(year), startDate: `${year}-01-01`, endDate: `${year}-12-31` });
    for (const [line, amount] of [["Insurance", 50_000], ["Home", 20_000], ["Clothing", 3_000]] as const) {
      repo.setBudgetLine({ planId, planningCategory: line, period: null, amountCents: amount });
    }
  }
  repo.changeLineFrom(first, "Insurance", "2027-06", 52_000);
  repo.upsertAccounts([{ id: "toy-checking", name: "Toy checking", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" }]);
  const regular = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(Date.UTC(2026, i + 1, 15)).toISOString().slice(0, 10);
    return charge("monthly-" + date, date, "Toy monthly insurance", 10_000);
  });
  repo.upsertTransactions([...regular, charge("y1", "2026-03-04", "Acme Insurance", 60_000)]);
});

afterEach(() => {
  repo?.connection().close();
  vi.unstubAllEnvs();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

function everyMonth(planId: string, category = "Insurance") {
  return repo.getBudgetLines(planId).find(l => l.period === null && l.planningCategory === category)?.amountCents;
}

function firstYearTotal() {
  const extras = budgets(clock).extras(first);
  const lines = expandChanges(repo.getBudgetLines(first), extras.changes, "2027-12");
  const input = { ...extras, lines, salary: DEFAULT_SALARY_ASSUMPTIONS };
  return Array.from({ length: 12 }, (_, i) =>
    lineBudget(input, "Insurance", "spending", "2027-" + String(i + 1).padStart(2, "0")).cents ?? 0
  ).reduce((sum, cents) => sum + cents, 0);
}

function placed(planId: string, billId: number, year: number, at: Date) {
  return budgets(() => at).extras(planId).bigMonths
    .filter(b => b.sourceId === billId && b.origin === "yearly-bill" && b.obligationYear === year)
    .reduce((sum, b) => sum + b.amountCents, 0);
}

test("adding a bill takes its share out of every open budget, logs it, and a year moves by the rounding only", () => {
  const before = firstYearTotal();
  const b = bills(clock).addBill(HOME);
  expect(store.listShares().map(s => [s.planId, s.cents])).toEqual([[first, 5_000], [next, 5_000]]);
  const raw = repo.connection().prepare("SELECT amount_cents FROM budget_lines WHERE plan_id=? AND planning_category=? AND period=''").pluck().get(first, "Insurance");
  expect(raw).toBe(50_000);
  expect(everyMonth(first)).toBe(45_000);
  expect(budgets(clock).extras(first).changes.find(c => c.planningCategory === "Insurance" && c.fromMonth === "2027-06")?.amountCents).toBe(47_000);
  expect(everyMonth(next)).toBe(45_000);
  expect(firstYearTotal() - before).toBe(1);
  const months = (id: string) => budgets(clock).extras(id).bigMonths.filter(m => m.sourceId === b.id && m.origin === "yearly-bill").map(m => m.month);
  expect(months(first)).toEqual(["2027-03"]);
  expect(months(next)).toEqual(["2028-03", "2029-03", "2030-03", "2031-03"]);
  expect(repo.getChangeLog(String(b.id)).filter(row => row.entityType === "yearly_bill").length).toBeGreaterThanOrEqual(3);
});

test("an edit changes this year and later, never a closed year", () => {
  const b = bills(clock).addBill(HOME);
  const edit = new Date(2028, 1, 10, 12);
  bills(() => edit).updateBill(b.id, { ...HOME, amountCents: 66_000 });
  expect(placed(first, b.id, 2027, edit)).toBe(60_001);
  expect(placed(next, b.id, 2028, edit)).toBe(66_000);
  expect(store.listTerms(b.id).map(t => [t.fromYear, t.amountCents])).toEqual([[2027, 60_001], [2028, 66_000]]);
  const later = new Date(2028, 1, 11, 12);
  bills(() => later).updateBill(b.id, { ...HOME, amountCents: 67_000 });
  expect(store.listTerms(b.id).find(t => t.fromYear === 2028)?.createdAt).toBe(later.toISOString());
  bills(() => later).updateBill(b.id, { ...HOME, amountCents: 67_000, planningCategory: "Home" });
  expect(store.listTerms(b.id).find(t => t.fromYear === 2028)?.planningCategory).toBe("Home");
  expect(store.getBill(b.id)?.planningCategory).toBe("Home");
});

test("a months-only edit keeps a learned amount (Revision 6, R6-2)", () => {
  const b = bills(clock).addBill(HOME);
  repo.upsertTransactions([charge("toy-settled", "2027-03-05", "Acme Insurance", 66_000)]);
  const expectedFor = (month: string, at: Date) =>
    bills(() => at).householdProjection().occurrences.find(o => o.billId === b.id && o.dueMonth === month)?.expectedCents;
  expect(expectedFor("2028-03", new Date(2027, 3, 15, 12))).toBe(66_000);
  // the same year as the payment: the edit's terms start in 2027, and the amount learned for 2028 survives it
  bills(() => new Date(2027, 3, 20, 12)).updateBill(b.id, { ...HOME, months: ["03", "09"] });
  expect(expectedFor("2028-03", new Date(2027, 3, 20, 12))).toBe(66_000);
  expect(store.listTerms(b.id).find(t => t.fromYear === 2028)?.amountCents).toBe(66_000);
  expect(expectedFor("2027-03", new Date(2027, 3, 20, 12))).toBe(60_001);   // this year's budget stays as it was
  // a later year, after the first budget closed: the edit (sent with the amount the bill now shows) starts in 2028
  expect(store.getBill(b.id)?.amountCents).toBe(66_000);
  bills(() => new Date(2028, 0, 12, 12)).updateBill(b.id, { ...HOME, amountCents: 66_000, months: ["03"] });
  expect(expectedFor("2028-03", new Date(2028, 0, 12, 12))).toBe(66_000);
  expect(store.listTerms(b.id).find(t => t.fromYear === 2028)?.amountCents).toBe(66_000);
});

test("taking out more than the line holds is refused, with nothing written", () => {
  expect(() => bills(clock).addBill({ ...HOME, planningCategory: "Clothing", amountCents: 600_000 })).toThrow(/less than this bill's share/);
  expect(everyMonth(first, "Clothing")).toBe(3_000);
  expect(store.listBills()).toHaveLength(0);
});

// Toy yearly amounts that together are exactly 12 times the row, none of them a whole twelfth: each share
// rounds up, so per-bill rounded shares would overdraw the row by a cent (orchestrator ruling, yearly-list check).
const three = (line: string, amounts: number[]) => amounts.map((amountCents, i) =>
  () => bills(clock).addBill({ ...HOME, planningCategory: line, label: "Toy bill " + i, payeeKey: "toy payee " + i, amountCents, months: [String(i + 4).padStart(2, "0")] }));
const sharesOn = (planId: string, line: string) => store.listShares(planId).filter(s => s.planningCategory === line).map(s => s.cents);

test("bills whose yearly amounts fill the every-month row exactly join, and the row ends at 0", () => {
  for (const add of three("Home", [79_998, 80_001, 80_001])) add();
  expect(everyMonth(first, "Home")).toBe(0);
  expect(everyMonth(next, "Home")).toBe(0);
  expect(sharesOn(first, "Home")).toEqual([6_666, 6_667, 6_667]);
  // each bill's year moves by its rounding only: within 6 cents (contracts, expected kind 4a)
  expect([79_998, 80_001, 80_001].map((y, i) => y - 12 * sharesOn(first, "Home")[i])).toEqual([6, -3, -3]);
});

test("bills that fill a budget change row exactly join; over by a real amount is refused", () => {
  repo.changeLineFrom(first, "Clothing", "2027-07", 2_000);
  const [a, b, c] = three("Clothing", [7_998, 8_001, 8_001]);
  a(); b();
  expect(() => bills(clock).addBill({ ...HOME, planningCategory: "Clothing", label: "Toy over", payeeKey: "toy over", amountCents: 8_013, months: ["06"] }))
    .toThrow(/less than this bill's share/);
  expect(store.listBills()).toHaveLength(2);
  c();
  expect(budgets(clock).extras(first).changes.find(ch => ch.planningCategory === "Clothing" && ch.fromMonth === "2027-07")?.amountCents).toBe(0);
  expect(everyMonth(first, "Clothing")).toBe(1_000);
  expect(sharesOn(next, "Clothing")).toEqual([666, 667, 667]);   // room left there too: still round(24,000 / 12)
});

test("bills whose shares round down still fill a row exactly: a share takes one more cent", () => {
  for (const planId of [first, next]) repo.setBudgetLine({ planId, planningCategory: "Gifts", period: null, amountCents: 10 });
  for (const add of three("Gifts", [40, 40, 40])) add();
  expect(sharesOn(first, "Gifts")).toEqual([4, 3, 3]);
  expect(everyMonth(first, "Gifts")).toBe(0);
});

test("three line edits in a row leave each share within a cent of its reserved amount's twelfth", () => {
  const [a, b] = three("Home", [79_998, 80_001]);
  const first3 = a(); b();
  const moving = bills(clock).addBill({ ...HOME, planningCategory: "Insurance", label: "Toy mover", payeeKey: "toy mover", amountCents: 80_001, months: ["08"] });
  bills(clock).updateBill(first3.id, { ...HOME, planningCategory: "Home", label: "Toy bill 0", payeeKey: "toy payee 0", amountCents: 70_000, months: ["04"] });
  for (const line of ["Home", "Insurance", "Home"]) {
    bills(clock).updateBill(moving.id, { ...HOME, planningCategory: line, label: "Toy mover", payeeKey: "toy mover", amountCents: 80_001, months: ["08"] });
  }
  const reserved = new Map([[first3.id, 79_998], [moving.id, 80_001]]);
  for (const s of store.listShares(first).filter(s => s.planningCategory === "Home")) {
    expect(Math.abs(s.cents - Math.round((reserved.get(s.billId) ?? 80_001) / 12))).toBeLessThanOrEqual(1);
  }
  expect(everyMonth(first, "Home")).toBe(0);
});

test("shares saved before the reserved amount was kept use the amount at signup, even after an edit", () => {
  const [a, b, c] = three("Home", [79_998, 80_001, 80_001]);
  const edited = a(); b();
  repo.connection().prepare("UPDATE yearly_bill_shares SET yearly_cents = NULL").run();   // as saved before 0202
  bills(clock).updateBill(edited.id, { ...HOME, planningCategory: "Home", label: "Toy bill 0", payeeKey: "toy payee 0", amountCents: 70_000, months: ["04"] });
  expect(() => bills(clock).addBill({ ...HOME, planningCategory: "Home", label: "Toy over", payeeKey: "toy over", amountCents: 80_013, months: ["09"] }))
    .toThrow(/less than this bill's share/);
  c();
  expect(sharesOn(first, "Home")).toEqual([6_666, 6_667, 6_667]);
  expect(everyMonth(first, "Home")).toBe(0);
});

test("a bill whose share rounds to 0 is still counted for room", () => {
  for (const planId of [first, next]) repo.setBudgetLine({ planId, planningCategory: "Gifts", period: null, amountCents: 1 });
  // 7 + 7 cents a year round to 1 cent a month, the whole row; a 5-cent bill (share 0) then makes it 2
  const [a, b, c] = three("Gifts", [7, 7, 5]);
  a(); b();
  expect(sharesOn(first, "Gifts")).toEqual([0, 1]);
  expect(c).toThrow(/less than this bill's share/);
  expect(store.listBills()).toHaveLength(2);
});

test("over the every-month row by a real amount is refused, with nothing written", () => {
  const [a, b] = three("Home", [79_998, 80_001]);
  a(); b();
  expect(() => bills(clock).addBill({ ...HOME, planningCategory: "Home", label: "Toy over", payeeKey: "toy over", amountCents: 80_013, months: ["09"] }))
    .toThrow(/less than this bill's share/);
  expect(store.listBills()).toHaveLength(2);
  expect(everyMonth(first, "Home")).toBe(20_000 - 13_333);   // round(160,000 / 12)
});

test("a line made only by a budget change takes a bill and gives its share from that change", () => {
  repo.changeLineFrom(first, "Pets", "2027-04", 1_000);
  repo.changeLineFrom(next, "Pets", "2028-01", 1_000);   // every open budget has the line, as the share needs
  expect(repo.getBudgetLines(first).some(l => l.planningCategory === "Pets")).toBe(false);
  bills(clock).addBill({ ...HOME, planningCategory: "Pets", label: "Toy vet plan", payeeKey: "toy vet", amountCents: 6_000, months: ["05"] });
  expect(budgets(clock).extras(first).changes.find(ch => ch.planningCategory === "Pets")?.amountCents).toBe(500);
  expect(() => bills(clock).addBill({ ...HOME, planningCategory: "Petz", takeOutOfLine: false })).toThrow("That budget line is not in your budget.");
});

test("a bill on a line that is not in the budget is refused, by the service and the route", async () => {
  const misspelled = { ...HOME, planningCategory: "Insurence", takeOutOfLine: false };
  expect(() => bills(clock).addBill(misspelled)).toThrow("That budget line is not in your budget. Pick one of your budget lines for this bill.");
  const express = (await import("express")).default;
  const { yearlyCostsRoutes } = await import("../../server/api/yearlyCostsRoutes.js");
  const server = express().use(express.json()).use("/api", yearlyCostsRoutes()).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const { port } = server.address() as import("node:net").AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/yearly/bills`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(misspelled) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("That budget line is not in your budget. Pick one of your budget lines for this bill.");
  } finally {
    server.close();
  }
  expect(store.listBills()).toHaveLength(0);
});

test("removing a bill puts its share back in open budgets and leaves a closed year as it was", () => {
  const b = bills(clock).addBill(HOME);
  const water = bills(clock).addBill({ ...HOME, payeeKey: "city water", label: "Water", amountCents: 10_000, takeOutOfLine: false });
  const at = new Date(2028, 1, 10, 12);
  bills(() => at).removeBill(b.id);
  bills(() => at).removeBill(water.id);
  expect([placed(first, b.id, 2027, at), placed(first, water.id, 2027, at)]).toEqual([60_001, 10_000]);
  expect(store.listShares().map(s => s.planId)).toEqual([first]);
  expect(store.listTerms(b.id).map(t => [t.fromYear, t.months])).toEqual([[2027, ["03"]], [2028, []]]);
  expect(everyMonth(next)).toBe(50_000);
  expect(placed(next, b.id, 2028, at) + placed(next, water.id, 2028, at)).toBe(0);
});

test("an every-month amount typed after a bill joined reads back as typed", () => {
  bills(clock).addBill(HOME);
  repo.setBudgetLine({ planId: first, planningCategory: "Insurance", period: null, amountCents: 46_000, source: "you" });
  expect(everyMonth(first)).toBe(46_000);
});

test("Salary settings carry the year's yearly bills", async () => {
  bills(clock).addBill(HOME);
  bills(clock).addBill({ ...HOME, label: "Water", payeeKey: "city water", amountCents: 10_000, months: ["01", "04", "07", "10"], takeOutOfLine: false });
  const { getSalarySettings } = await import("../../server/services/salarySettingsService.js");
  expect(getSalarySettings().yearlyBillsAnnualCents).toBe(100_001);
});

test("next year's suggestion leaves a yearly bill out", async () => {
  bills(clock).addBill(HOME);
  const { setupService } = await import("../../server/services/setupService.js");
  expect(setupService(clock).suggestions(first).find(s => s.planningCategory === "Insurance")?.amountCents).toBe(10_000);
});

const SPRING = { planningCategory: "Clothing", label: "Spring wardrobe", amountCents: 25_000, when: { kind: "every-year", monthOfYear: "03" } };
const raisedIn = (planId: string, at: Date) => budgets(() => at).extras(planId).bigMonths
  .filter(x => x.origin === "raise").map(x => [x.month, x.amountCents]);

test("editing a raise changes this month and later; earlier months, closed ones included, keep the old amount", () => {   // Revision 5, R5-7
  const r = bills(clock).addRaise(SPRING);                                // made 2027-02-10
  const at = new Date(2028, 1, 10, 12);                                   // plan-2027 has closed
  bills(() => at).updateRaise(r.id, { ...SPRING, amountCents: 30_000 });
  expect(raisedIn(first, at)).toEqual([["2027-03", 25_000]]);
  expect(raisedIn(next, at).slice(0, 2)).toEqual([["2028-03", 30_000], ["2029-03", 30_000]]);
  expect(store.listRaises(true).map(x => [x.amountCents, x.archivedAt !== null])).toEqual([[25_000, true], [30_000, false]]);
});

test("a raise lands in the one plan that owns its month; a once-raise whose month has passed cannot be edited", () => {
  const once = bills(clock).addRaise({ ...SPRING, when: { kind: "once", month: "2028-09" } });
  expect(raisedIn(first, clock())).toEqual([]);
  expect(raisedIn(next, clock())).toEqual([["2028-09", 25_000]]);
  const later = new Date(2028, 9, 5, 12);
  expect(() => bills(() => later).updateRaise(once.id, { ...SPRING, when: { kind: "once", month: "2028-12" } })).toThrow("That raise's month has passed, so it stays as it was.");
  expect(store.listRaises().map(x => x.id)).toEqual([once.id]);
  bills(() => later).removeRaise(once.id);
  expect(store.listRaises()).toEqual([]);
});

test("proposals from history write nothing: no bill, raise, share, line or big month appears until you accept one", () => {
  repo.upsertTransactions([charge("y0", "2025-03-03", "Acme Insurance", 60_000)]);
  const snapshot = () => JSON.stringify([store.listBills(true), store.listRaises(true), store.listShares(), store.listTerms(),
    repo.getBudgetLines(first), repo.listBigMonths(first), repo.listBudgetChanges(first)]);
  const before = snapshot();
  const found = bills(clock).proposals();
  expect(found.bills.map(p => [p.label, p.months])).toEqual([["Acme Insurance", ["03"]]]);
  expect(snapshot()).toBe(before);
  expect(budgets(clock).extras(first).bigMonths).toEqual([]);
});

test("a payment a bill suggestion claims is not also suggested as a raise", () => {
  repo.upsertTransactions([charge("y0", "2025-03-03", "Acme Insurance", 60_000), charge("y1", "2026-03-03", "Acme Insurance", 60_000)]);
  const found = bills(clock).proposals();
  expect(found.bills.map(p => p.label)).toEqual(["Acme Insurance"]);
  expect(found.raises).toEqual([]);
});

test("a one-time raise for a month already past is refused, with nothing written", () => {
  expect(() => bills(clock).addRaise({ ...SPRING, when: { kind: "once", month: "2027-01" } })).toThrow("already passed");
  expect(store.listRaises(true)).toEqual([]);
  expect(bills(clock).addRaise({ ...SPRING, when: { kind: "once", month: "2027-02" } }).id).toBeGreaterThan(0);
});
