import { expect, test } from "vitest";
import { rollupMonthly } from "../../src/domain/rollups";
import type { NormalizedTxn, Account } from "../../src/domain/types";

const acc: Account[] = [
  { id: "Checking", name: "Pinecrest Checking", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  { id: "PartnerCard", name: "Lakeshore Cash Back Card", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "partner" },
];
const t = (o: Partial<NormalizedTxn>): NormalizedTxn => ({
  sourceTransactionId: Math.random().toString(), accountId: "Checking", date: "2026-08-01",
  amountCents: 0, sourceCategory: "Groceries", merchant: null, isTransfer: false, sourceUpdatedAt: null, ...o,
});

test("spend magnitude nets refunds and is positive", () => {
  const r = rollupMonthly(
    [t({ amountCents: -10000, sourceCategory: "Groceries" }), t({ amountCents: 2500, sourceCategory: "Groceries" })],
    acc, {});
  const g = r.find((x) => x.planningCategory === "Groceries")!;
  expect(g.kind).toBe("expense");
  expect(g.amountCents).toBe(7500); // 100 - 25 = 75 spent
});
test("excludes transfers and non-spend accounts", () => {
  const r = rollupMonthly([
    t({ amountCents: -9999, isTransfer: true, sourceCategory: "Transfer" }),
    t({ amountCents: -5000, accountId: "PartnerCard", sourceCategory: "Groceries" }),
  ], acc, {});
  expect(r).toHaveLength(0);
});
test("income rolls up separately and positive", () => {
  const r = rollupMonthly([t({ amountCents: 500000, sourceCategory: "Paychecks" })], acc, {});
  const inc = r.find((x) => x.kind === "income")!;
  expect(inc.amountCents).toBe(500000);
});
test("'Other Income' / 'Business Income' roll up as INCOME, not as negative expense", () => {
  // Bug: these fell through the exact-match income list and showed up as negative
  // expense lines, deflating the budget. Any category containing "income" is income.
  const r = rollupMonthly([
    t({ amountCents: 30000, sourceCategory: "Other Income" }),
    t({ amountCents: 50000, sourceCategory: "Business Income" }),
  ], acc, {});
  expect(r.every((x) => x.kind === "income")).toBe(true);
  expect(r.find((x) => x.planningCategory === "Other Income")!.amountCents).toBe(30000);
  expect(r.find((x) => x.planningCategory === "Business Income")!.amountCents).toBe(50000);
  expect(r.some((x) => x.kind === "expense")).toBe(false);
});
test("applies category mapping and groups by month", () => {
  const r = rollupMonthly([
    t({ date: "2026-08-01", amountCents: -1000, sourceCategory: "Coffee Shops" }),
    t({ date: "2026-09-01", amountCents: -2000, sourceCategory: "Restaurants" }),
  ], acc, { "Coffee Shops": "Dining Out", "Restaurants": "Dining Out" });
  expect(r.filter((x) => x.planningCategory === "Dining Out").map((x) => [x.period, x.amountCents]))
    .toEqual([["2026-08", 1000], ["2026-09", 2000]]);
});
test("a Credit Card Payment never rolls up as spending, even when the pair matcher missed its other leg", () => {
  const r = rollupMonthly([
    t({ amountCents: -150000, sourceCategory: "Credit Card Payment" }),
    t({ amountCents: -1200, sourceCategory: "Groceries" }),
  ], acc, {});
  expect(r.map((x) => x.planningCategory)).toEqual(["Groceries"]);
});

// The charity pot: Charity a month is what reached a charity: the Charity rows on the cards,
// plus gifts paid straight from the pot. Money into the pot and paybacks out of it never count. The
// pot's own rows stay out of every other figure; they are read by account.
const withPot: Account[] = [...acc, { id: "pot", name: "Giving", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "me", maaserPot: true }];
const charity = (r: ReturnType<typeof rollupMonthly>, period = "2026-10") => r.find((x) => x.period === period && x.planningCategory === "Charity" && x.kind === "expense")?.amountCents;
test("Charity is what reached a charity: card gifts plus gifts straight from the pot; set-aside and paybacks never", () => {
  const r = rollupMonthly([
    t({ accountId: "pot", date: "2026-10-02", amountCents: 150000, sourceCategory: "Maaser" }),
    t({ date: "2026-10-08", amountCents: -50000, sourceCategory: "Charity" }),
    t({ accountId: "pot", date: "2026-10-15", amountCents: -4000, sourceCategory: "Transfer", isTransfer: true, transferPartnerAccountId: "Checking" }),
    t({ date: "2026-10-15", amountCents: 4000, sourceCategory: "Transfer", isTransfer: true, transferPartnerAccountId: "pot" }),
    t({ accountId: "pot", date: "2026-10-18", amountCents: -50000, sourceCategory: null, description: "ZELLE PAYMENT TO A CHARITY" }),
    t({ accountId: "pot", date: "2026-10-20", amountCents: -250000, sourceCategory: null, description: "ATM WITHDRAWAL" }),
  ], withPot, {});
  expect(charity(r)).toBe(350000);
  expect(r.map((x) => [x.planningCategory, x.kind])).toEqual([["Charity", "expense"]]);
});
test("each month's card gifts in full, a late payback counts nowhere", () => {
  const r = rollupMonthly([
    t({ date: "2026-02-10", amountCents: -80000, sourceCategory: "Charity" }),
    t({ date: "2026-03-10", amountCents: -80000, sourceCategory: "Charity" }),
    t({ date: "2026-05-10", amountCents: -50000, sourceCategory: "Charity" }),
    t({ accountId: "pot", date: "2026-05-20", amountCents: -85000, sourceCategory: "Transfer", isTransfer: true, transferPartnerAccountId: "Checking" }),
  ], withPot, {});
  expect([charity(r, "2026-02"), charity(r, "2026-03"), charity(r, "2026-04"), charity(r, "2026-05")]).toEqual([80000, 80000, undefined, 50000]);
});
test("the pot's own rows never count as ordinary spending or income, counted or not, flagged or not (rule 3)", () => {
  const countedPot = withPot.map((a) => (a.id === "pot" ? { ...a, includeInSpend: true } : a));
  const r = rollupMonthly([
    t({ accountId: "pot", amountCents: 90000, sourceCategory: "Paychecks" }),
    t({ accountId: "pot", amountCents: -50000, sourceCategory: "Transfer", isTransfer: true, transferPartnerAccountId: "Checking" }),
    t({ accountId: "pot", amountCents: 5, sourceCategory: "Interest" }),
  ], countedPot, {});
  expect(r).toEqual([]);
});
test("a pot gift on an archived flagged row counts too", () => {
  const both: Account[] = [...withPot, { ...withPot[2], id: "old", name: "Giving (...0505)", archived: true }];
  const r = rollupMonthly([t({ accountId: "old", date: "2026-03-01", amountCents: -27000, sourceCategory: null, description: "ZELLE PAYMENT TO SOMEONE" })], both, {});
  expect(charity(r, "2026-03")).toBe(27000);
});
test("no pot flagged: a card gift counts in full, as before", () => {
  expect(charity(rollupMonthly([t({ date: "2026-10-08", amountCents: -50000, sourceCategory: "Charity" })], acc, {}))).toBe(50000);
});
