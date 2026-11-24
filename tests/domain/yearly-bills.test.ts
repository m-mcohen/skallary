import { expect, test } from "vitest";
import { renameMap } from "../../src/domain/merchants";
import { annualBillsCents, firstOpenYear, fitShares, monthlyShareCents, projectYearlyCosts, type Projection, type ProjectionInput, type YearlyBill } from "../../src/domain/yearly-costs";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { BillEvent, BillEventKind } from "../../src/data/yearly-costs.store";

function bill(over: Partial<YearlyBill> = {}): YearlyBill {
  return { id: 1, planningCategory: "Insurance", label: "Home policy", payeeKey: "acme insurance", accountId: null,
    amountCents: 60_000, months: ["03"], createdAt: "2027-01-05", archivedAt: null, ...over };
}
function charge(id: string, date: string, amountCents: number, payee = "Acme Insurance", accountId = "acc-1"): NormalizedTxn {
  return { sourceTransactionId: id, accountId, date, amountCents, payee, merchant: null,
    sourceCategory: "Insurance", isTransfer: false, sourceUpdatedAt: null };
}
function counted(id: string): Account {
  return { id, name: id, type: "checking", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" };
}
const notCounted = (id: string) => ({ ...counted(id), includeInSpend: false });
function project(over: Partial<ProjectionInput>): Projection {
  return projectYearlyCosts({ from: "2026-01", to: "2028-12", today: "2027-02-10", bills: [], terms: [], events: [], raises: [],
    holidays: [], calendars: [], txns: [], accounts: [counted("acc-1")], renames: renameMap([]), ...over });
}
function occ(p: Projection, due: string) {
  const occurrence = p.occurrences.find(o => o.dueMonth === due);
  if (!occurrence) throw Error("Missing occurrence " + due);
  return occurrence;
}
function ev(billId: number, dueMonth: string, kind: BillEventKind, sourceTransactionId: string | null = null): BillEvent {
  return { id: 1, billId, dueMonth, kind, obligationYear: Number(dueMonth.slice(0, 4)), sourceTransactionId, createdAt: dueMonth + "-01" };
}
const t = (fromYear: number, amountCents: number, createdAt: string) => ({ billId: 1, months: ["03"], planningCategory: "Insurance", fromYear, amountCents, createdAt });
const plan = (id: string, startDate: string, endDate: string) => ({ id, name: id, startDate, endDate, createdAt: startDate });

test("a charge 20 days before the due month lands the bill; 21 days before does not", () => {
  const at = (d: string) => occ(project({ bills: [bill()], txns: [charge("c1", d, -60_000)], today: "2027-02-15" }), "2027-03");
  expect(at("2027-02-09")).toMatchObject({ status: "landed", paymentMonth: "2027-02", paidCents: 60_000 });
  expect(at("2027-02-08")).toMatchObject({ status: "upcoming", paymentMonth: "2027-03", paidCents: 0 });
});
test("an unpaid bill is late in this month for 3 months after its due month, then asks", () => {
  const at = (today: string) => occ(project({ bills: [bill()], today }), "2027-03");
  expect(at("2027-04-10")).toMatchObject({ status: "late", paymentMonth: "2027-04" });
  expect(at("2027-06-30")).toMatchObject({ status: "late", paymentMonth: "2027-06" });
  expect(at("2027-07-01")).toMatchObject({ status: "ask", askReason: "still-exists", paymentMonth: "2027-06" });
});
test("part payments add up; the bill lands at 65 percent of the expected amount", () => {
  const two = (second: number) => project({ bills: [bill()], today: "2027-04-10", txns: [charge("c1", "2027-03-05", -24_000), charge("c2", "2027-03-20", second)] });
  expect(occ(two(-14_999), "2027-03")).toMatchObject({ status: "part-paid", paidCents: 38_999 });
  expect(two(-14_999).bigMonths.filter(b => b.obligationYear === 2027).map((b) => [b.month, b.amountCents])).toEqual([["2027-03", 38_999], ["2027-04", 21_001]]);
  expect(occ(two(-15_000), "2027-03")).toMatchObject({ status: "landed", paidCents: 39_000 });
  expect(two(-15_000).bigMonths.filter((b) => b.obligationYear === 2027).map((b) => [b.month, b.amountCents])).toEqual([["2027-03", 60_000]]);
});
test("a bill paid in three parts lands at the second; the third still attaches and next year learns the whole total", () => {   // contracts B-7
  const parts = [charge("p1", "2027-03-05", -22_000), charge("p2", "2027-03-15", -22_000), charge("p3", "2027-04-20", -22_000)];
  const p = project({ bills: [bill()], today: "2027-07-01", txns: parts });
  expect(occ(p, "2027-03")).toMatchObject({ status: "landed", paidCents: 66_000, matchedTxnIds: ["p1", "p2", "p3"], paymentMonth: "2027-04" });
  expect(p.yearlyTxnIds).toContain("p3");
  expect(occ(p, "2028-03").expectedCents).toBe(66_000);
  // between the second and third parts, with the window still open: nothing learned yet
  const mid = project({ bills: [bill()], today: "2027-03-20", txns: parts.slice(0, 2) });
  expect(occ(mid, "2027-03")).toMatchObject({ status: "landed", paidCents: 44_000 });
  expect(occ(mid, "2028-03").expectedCents).toBe(60_000);
  expect(mid.notices.filter(n => n.kind === "new-amount")).toEqual([]);
});
test("a bill landing at a new amount keeps this year's budget, uses the new amount next year, and says so", () => {
  const p = project({ bills: [bill()], today: "2027-04-01", txns: [charge("c1", "2027-03-05", -66_000)] });
  expect(occ(p, "2027-03")).toMatchObject({ expectedCents: 60_000, paidCents: 66_000, status: "landed" });
  expect(occ(p, "2028-03").expectedCents).toBe(66_000);
  expect(p.notices).toContainEqual({ kind: "new-amount", billId: 1, obligationYear: 2027, dueMonth: "2027-03", fromCents: 60_000, toCents: 66_000 });
});
test("an unknown amount is a reminder at zero that any payee charge in the window lands", () => {
  const p = project({ bills: [bill({ amountCents: null })], today: "2027-04-01", txns: [charge("c1", "2027-03-05", -41_234)] });
  expect(occ(p, "2027-03")).toMatchObject({ expectedCents: 0, status: "landed" });
  expect(occ(p, "2028-03").expectedCents).toBe(0);
});
test("a December bill paid in January stays in last year's obligation and is counted once", () => {
  const p = project({ bills: [bill({ months: ["12"], createdAt: "2026-06-01T00:00:00Z" })], today: "2027-01-15", txns: [charge("c1", "2027-01-10", -60_000)] });
  expect(occ(p, "2026-12")).toMatchObject({ obligationYear: 2026, paymentMonth: "2027-01", status: "landed", late: true });
  expect(p.bigMonths.filter((b) => b.obligationYear === 2026).map((b) => b.month)).toEqual(["2027-01"]);
});
test("two bills from one payee are told apart by amount; a charge near neither asks", () => {
  const bills = [bill({ id: 1, amountCents: 30_000 }), bill({ id: 2, amountCents: 120_000 })];
  const told = project({ bills, today: "2027-04-01", txns: [charge("c1", "2027-03-05", -30_500), charge("c2", "2027-03-07", -119_000)] });
  expect(told.occurrences.filter((o) => o.dueMonth === "2027-03").map((o) => [o.billId, o.matchedTxnIds])).toEqual([[1, ["c1"]], [2, ["c2"]]]);
  const unsure = project({ bills, today: "2027-03-20", txns: [charge("c3", "2027-03-05", -60_000)] });
  expect(unsure.occurrences.filter((o) => o.dueMonth === "2027-03").map((o) => [o.status, o.askReason, o.candidateTxnIds])).toEqual([["ask", "which-bill", ["c3"]], ["ask", "which-bill", ["c3"]]]);
});
test("matching follows a merchant rename", () => {
  const txns = [charge("c1", "2027-03-05", -60_000, "ACME INS 0042")];
  const with_ = project({ bills: [bill()], txns, today: "2027-04-01", renames: renameMap([{ sourceName: "ACME INS 0042", displayName: "Acme Insurance" }]) });
  expect(occ(with_, "2027-03").status).toBe("landed");
  expect(occ(project({ bills: [bill()], txns, today: "2027-04-01" }), "2027-03").status).toBe("late");
});
test("a refund from the payee is not a payment and does not change next year's amount", () => {
  const p = project({ bills: [bill()], today: "2027-05-01", txns: [charge("c1", "2027-03-05", -60_000), charge("r1", "2027-04-02", 10_000)] });
  expect(occ(p, "2027-03")).toMatchObject({ paidCents: 60_000, matchedTxnIds: ["c1"] });
  expect(project({ bills: [bill()], today: "2027-04-03", txns: [charge("refund", "2027-04-02", 10_000)] }).yearlyTxnIds).toEqual([]);
  expect(occ(p, "2028-03").expectedCents).toBe(60_000);
});
test("picked and ticked by hand", () => {
  // 2027-07-15 is past the late period (ends 2027-06-30): only the pick can land it
  const picked = project({ bills: [bill()], today: "2027-07-20", txns: [charge("c9", "2027-07-15", -60_000)], events: [ev(1, "2027-03", "picked", "c9")] });
  expect(occ(picked, "2027-03")).toMatchObject({ status: "landed", paymentMonth: "2027-07", late: true });
  const ticked = project({ bills: [bill()], today: "2027-05-20", events: [ev(1, "2027-03", "ticked")] });
  expect(occ(ticked, "2027-03")).toMatchObject({ status: "landed", paidCents: 60_000, paymentMonth: "2027-03" });
});
test("'gone' keeps what came before it; a removal's terms row with no months ends the bill from its year", () => {
  const b = bill({ months: ["03", "09"], archivedAt: "2027-09-02T00:00:00Z" });
  const txns = [charge("c1", "2027-03-05", -60_000)];
  const gone = project({ bills: [b], txns, today: "2027-09-02", events: [ev(1, "2027-09", "gone")] });
  expect(gone.bigMonths.map((x) => x.month)).toEqual(["2027-03"]);
  const first = { ...t(2027, 60_000, "2027-01-05"), months: ["03", "09"] };
  const ended = (fromYear: number) => ({ ...t(fromYear, 60_000, "2027-09-02"), months: [] as string[] });
  expect(project({ bills: [b], txns, today: "2027-09-02", terms: [ended(2027)] }).bigMonths).toEqual([]);
  expect(project({ bills: [b], txns, today: "2027-09-02", terms: [first, ended(2028)] }).bigMonths.map((x) => x.month)).toEqual(["2027-03", "2027-09"]);
});
test("months a closed plan owns only as the latest earlier plan never hold an edit back", () => {
  const plans = [plan("plan-2027", "2027-01-01", "2027-12-31")];
  const p = project({ bills: [bill()], today: "2028-02-10" });
  expect(firstOpenYear(bill(), p.occurrences, plans, "2028-02-10")).toBe(2028);
});
test("a charge on an account that does not count never lands a bill", () => {
  const p = project({ bills: [bill()], today: "2027-04-01", accounts: [counted("acc-1"), notCounted("acc-2")], txns: [charge("c1", "2027-03-05", -60_000, "Acme Insurance", "acc-2")] });
  expect(occ(p, "2027-03").status).toBe("late");
  expect(p.yearlyTxnIds).toEqual([]);
});
test("an explicit amount edit wins over an earlier payment; a later payment updates it", () => {
  const terms = [t(2027, 60_000, "2027-01-05"), t(2028, 70_000, "2027-04-10")];
  const paid = [charge("c1", "2027-03-05", -66_000)];
  expect(occ(project({ bills: [bill()], terms, today: "2027-04-15", txns: paid }), "2028-03").expectedCents).toBe(70_000);
  const q = project({ bills: [bill()], terms, to: "2029-12", today: "2028-04-15", txns: [...paid, charge("c2", "2028-03-06", -72_000)] });
  expect(occ(q, "2029-03").expectedCents).toBe(72_000);
  expect(q.notices).toContainEqual(expect.objectContaining({ kind: "new-amount", obligationYear: 2028, fromCents: 70_000, toCents: 72_000 }));
});
test("the share is the rounded twelfth of a year's payments, so a year moves by 6 cents at most", () => {
  expect(monthlyShareCents({ amountCents: 10_001, months: ["03"] })).toBe(833);
  expect(monthlyShareCents({ amountCents: 10_001, months: ["01", "04", "07", "10"] })).toBe(3_334);
  expect(annualBillsCents([bill({ amountCents: 10_001 }), bill({ amountCents: 2_500, months: ["01", "07"] }), bill({ amountCents: null })])).toBe(15_001);
});

// Orchestrator ruling (yearly-list check, as revised): a row fits when the rounded shares fit. Invented amounts.
test("a row fits when round(yearly total / 12) fits it, and a full row ends at 0", () => {
  expect(fitShares([100], [{ billId: 1, yearlyCents: 1201 }])).toEqual(new Map([[1, 100]]));
  const forty = fitShares([10], [1, 2, 3].map(billId => ({ billId, yearlyCents: 40 })));
  expect(forty).toEqual(new Map([[1, 4], [2, 3], [3, 3]]));
  // room left on the row: the shares still sum to round(120 / 12) = 10, not 9
  expect(fitShares([11], [1, 2, 3].map(billId => ({ billId, yearlyCents: 40 })))).toEqual(new Map([[1, 4], [2, 3], [3, 3]]));
  expect(fitShares([100], [{ billId: 1, yearlyCents: 1_300 }])).toBeNull();   // 108 cents a month on a 100-cent row
});
