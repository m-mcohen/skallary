// tests/domain/maaser-pot.test.ts -- the charity pot as a yearly ledger of totals.
// A share of the pay that lands in the bank goes into a set-aside account (the pot); a gift is paid
// by card or checking and the pot pays the account back, or the pot pays a charity directly. Invented figures.
import { describe, expect, test } from "vitest";
import { maaserFiguresOf, maaserLedger, maaserLedgerView, maaserPotAccount, maaserRole, potAccountIds, potRowKind } from "../../src/domain/maaser-pot";
import type { MaaserMark } from "../../src/domain/maaser-marks";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const CHK: Account = { id: "chk", name: "Checking", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" };
const POT: Account = { ...CHK, id: "pot", name: "Giving", includeInSpend: false, maaserPot: true, balanceCents: 420000, balanceDate: "2026-10-19" };
const PARTNER_CARD: Account = { ...CHK, id: "partner-card", name: "Partner Card", owner: "partner" };
let n = 0;
const row = (accountId: string, date: string, amountCents: number, sourceCategory: string | null, over: Partial<NormalizedTxn> = {}): NormalizedTxn => ({
  sourceTransactionId: `t${++n}`, accountId, date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over,
});

describe("maaserPotAccount", () => {
  test("the flagged account; an archived one does not count; none gives null", () => {
    expect(maaserPotAccount([CHK, POT])?.id).toBe("pot");
    expect(maaserPotAccount([CHK, { ...POT, archived: true }])).toBeNull();
    expect(maaserPotAccount([CHK])).toBeNull();
  });
});

describe("potAccountIds", () => {
  test("lists every flagged row, archived or not", () => {
    const OLD: Account = { ...POT, id: "old", archived: true };
    expect([...potAccountIds([CHK, POT, OLD])].sort()).toEqual(["old", "pot"]);
    expect(potAccountIds([CHK]).size).toBe(0);
  });
});

describe("potRowKind (and pay into the pot)", () => {
  const ids = new Set(["pot"]);
  test("a transfer out to the owner's own account, by the matcher, a rule, the 0010 adjustment or the card payment category, is a payback", () => {
    expect(potRowKind(row("pot", "2026-10-15", -5000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" }), ids, {})).toBe("payback");
    expect(potRowKind(row("pot", "2026-05-08", -9000, "Maaser", { isTransfer: true, transferByCorrection: true }), ids, {})).toBe("payback");
    expect(potRowKind(row("pot", "2026-05-08", -40000, "Credit Card Payment"), ids, {})).toBe("payback");
  });
  test("every other outflow is a gift straight from the pot: cash, Zelle, PayPal, a check", () => {
    expect(potRowKind(row("pot", "2026-10-20", -250000, null, { description: "ATM WITHDRAWAL" }), ids, {})).toBe("gift");
    expect(potRowKind(row("pot", "2026-10-18", -50000, "Charity", { description: "ZELLE PAYMENT TO A CHARITY" }), ids, {})).toBe("gift");
  });
  test("a deposit paired with the owner's own account is set aside; an unpaired deposit is pay", () => {
    expect(potRowKind(row("pot", "2026-10-15", 50000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" }), ids, {})).toBe("set_aside");
    expect(potRowKind(row("pot", "2026-02-06", 60000, "Maaser", { isTransfer: true, transferByCorrection: true, description: "EXAMPLE PAYROLL DIRECT DEP" }), ids, {})).toBe("pay");
  });
  test("not a pot row, or no amount: null", () => {
    expect(potRowKind(row("chk", "2026-10-15", -5000, "Charity"), ids, {})).toBeNull();
    expect(potRowKind(row("pot", "2026-10-15", 0, "Transfer"), ids, {})).toBeNull();
  });
});

describe("maaserRole: which rows take a mark", () => {
  const accounts = [CHK, POT, PARTNER_CARD];
  test("a Charity row on the owner's card and a pot gift are gifts; income on the owner's account and pay into the pot are income", () => {
    expect(maaserRole(row("chk", "2026-10-08", -60000, "Charity"), accounts, {})).toBe("gift");
    expect(maaserRole(row("pot", "2026-10-18", -50000, null, { description: "ZELLE PAYMENT TO A CHARITY" }), accounts, {})).toBe("gift");
    expect(maaserRole(row("chk", "2026-09-21", 200000, "Other Income"), accounts, {})).toBe("income");
    expect(maaserRole(row("pot", "2026-02-06", 60000, "Maaser", { isTransfer: true, transferByCorrection: true }), accounts, {})).toBe("income");
  });
  test("The partner's rows, transfers, paybacks, set-asides and other spending take no mark", () => {
    expect(maaserRole(row("partner-card", "2026-10-08", -3000, "Charity"), accounts, {})).toBeNull();
    expect(maaserRole(row("chk", "2026-10-08", -60000, "Charity", { isTransfer: true }), accounts, {})).toBeNull();
    expect(maaserRole(row("pot", "2026-10-15", -5000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" }), accounts, {})).toBeNull();
    expect(maaserRole(row("chk", "2026-10-08", -5000, "Groceries"), accounts, {})).toBeNull();
    expect(maaserRole(row("nowhere", "2026-10-08", -5000, "Charity"), accounts, {})).toBeNull();
  });
});

describe("maaserFiguresOf: the rows behind each ledger figure (drill-down)", () => {
  const accounts = [CHK, POT, PARTNER_CARD];
  test("each kind of row sits in the figure the ledger adds it to", () => {
    expect(maaserFiguresOf(row("chk", "2026-10-08", -60000, "Charity"), accounts, {})).toEqual(["givenCards"]);
    expect(maaserFiguresOf(row("pot", "2026-10-18", -50000, null, { description: "ZELLE PAYMENT TO A CHARITY" }), accounts, {})).toEqual(["givenPot"]);
    expect(maaserFiguresOf(row("pot", "2026-10-15", -5000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" }), accounts, {})).toEqual(["reimbursed"]);
    expect(maaserFiguresOf(row("pot", "2026-10-15", 50000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" }), accounts, {})).toEqual(["setAside"]);
    expect(maaserFiguresOf(row("pot", "2026-10-02", 90000, "Maaser"), accounts, {}).sort()).toEqual(["income", "setAside"]);
    expect(maaserFiguresOf(row("chk", "2026-09-21", 200000, "Other Income"), accounts, {})).toEqual(["income"]);
  });
  test("The partner's rows, ordinary spending and a gift marked not counted sit in no figure", () => {
    expect(maaserFiguresOf(row("partner-card", "2026-10-08", -3000, "Charity"), accounts, {})).toEqual([]);
    expect(maaserFiguresOf(row("chk", "2026-10-08", -5000, "Groceries"), accounts, {})).toEqual([]);
    const gift = row("chk", "2026-10-08", -5000, "Charity");
    expect(maaserFiguresOf(gift, accounts, {}, { sourceTransactionId: gift.sourceTransactionId, kind: "not_maaser", countedCents: null, updatedAt: "" })).toEqual([]);
  });
});

describe("maaserLedger", () => {
  const base = { accounts: [CHK, POT, PARTNER_CARD], mapping: {}, marks: [] as MaaserMark[], maaserRate: 0.1, availableCents: 270000 };
  test("October 2026: card gifts, pay into the pot, a payback, a Zelle gift and a cash gift from the pot", () => {
    const prepared = [
      row("pot", "2026-10-02", 150000, "Maaser", { description: "PAYROLL" }),
      row("chk", "2026-10-08", -60000, "Charity"),
      row("pot", "2026-10-15", -5000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" }),
      row("chk", "2026-10-15", 5000, "Transfer", { isTransfer: true, transferPartnerAccountId: "pot" }),
      row("pot", "2026-10-18", -50000, null, { description: "ZELLE PAYMENT TO A CHARITY" }),
      row("pot", "2026-10-20", -250000, null, { description: "ATM WITHDRAWAL" }),
    ];
    const l = maaserLedger({ ...base, prepared, from: "2026-10-01", to: "2026-10-31" });
    expect(l.setAsideCents).toBe(150000);
    expect(l.countedIncomeCents).toBe(150000);
    expect(l.owedCents).toBe(15000);
    expect(l.givenFromCardsCents).toBe(60000);
    expect(l.givenFromPotCents).toBe(300000);
    expect(l.givenCents).toBe(360000);
    expect(l.reimbursedCents).toBe(5000);
    expect(l.potOwesYouCents).toBe(55000);
    expect(l.notYetSetAsideCents).toBe(15000 - 150000);
    expect(l.beyondMaaserCents).toBe(0);
  });
  test("Feb to May 2026: late paybacks are totals, never matched by month", () => {
    const aspen = (date: string) => row("pot", date, 60000, "Maaser", { isTransfer: true, transferByCorrection: true, description: "EXAMPLE PAYROLL" });
    const prepared = [
      aspen("2026-02-06"), aspen("2026-03-06"), aspen("2026-04-06"), aspen("2026-05-06"),
      row("chk", "2026-02-10", -80000, "Charity"), row("chk", "2026-03-10", -80000, "Charity"),
      row("chk", "2026-05-10", -50000, "Charity"),
      row("pot", "2026-05-20", -80000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" }),
    ];
    const l = maaserLedger({ ...base, prepared, from: "2026-01-01", to: "2026-05-31" });
    expect(l.setAsideCents).toBe(240000);
    expect(l.owedCents).toBe(24000);
    expect(l.givenFromCardsCents).toBe(210000);
    expect(l.reimbursedCents).toBe(80000);
    expect(l.potOwesYouCents).toBe(130000);
  });
  test("paid back more than given on cards reads negative (an unmatched $400 payback)", () => {
    const l = maaserLedger({ ...base, prepared: [row("pot", "2026-05-08", -40000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" })], from: "2026-05-01", to: "2026-05-31" });
    expect(l.potOwesYouCents).toBe(-40000);
  });
  test("The partner's gift never counts, whatever the account's include flag says", () => {
    const l = maaserLedger({ ...base, accounts: [CHK, POT, { ...PARTNER_CARD, includeInSpend: true }], prepared: [row("partner-card", "2026-10-08", -3000, "Charity")], from: "2026-10-01", to: "2026-10-31" });
    expect(l.givenFromCardsCents).toBe(0);
  });
  test("a partial income mark: the $2,000 check counts as $1,600; a none mark counts as nothing", () => {
    const check = row("chk", "2026-09-21", 200000, "Other Income");
    const part: MaaserMark = { sourceTransactionId: check.sourceTransactionId, kind: "income", countedCents: 160000, updatedAt: "" };
    expect(maaserLedger({ ...base, prepared: [check], marks: [part], from: "2026-01-01", to: "2026-12-31" }).owedCents).toBe(16000);
    expect(maaserLedger({ ...base, prepared: [check], marks: [{ ...part, countedCents: null }], from: "2026-01-01", to: "2026-12-31" }).countedIncomeCents).toBe(0);
  });
  test("a payroll deposit straight into the pot is income and set aside; a manual set-aside is set aside only", () => {
    const prepared = [
      row("pot", "2026-01-07", 70000, "Maaser", { isTransfer: true, transferByCorrection: true }),
      row("chk", "2026-10-15", -110000, "Transfer", { isTransfer: true, transferPartnerAccountId: "pot" }),
      row("pot", "2026-10-15", 110000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" }),
    ];
    const l = maaserLedger({ ...base, prepared, from: "2026-01-01", to: "2026-12-31" });
    expect(l.setAsideCents).toBe(70000 + 110000);
    expect(l.countedIncomeCents).toBe(70000);
  });
  test("a not-counted mark leaves a card gift and a pot gift out of the ledger", () => {
    const gift = row("chk", "2026-10-08", -5000, "Charity");
    const potGift = row("pot", "2026-03-01", -27000, null, { description: "ZELLE PAYMENT TO SOMEONE" });
    const marks: MaaserMark[] = [gift, potGift].map((t) => ({ sourceTransactionId: t.sourceTransactionId, kind: "not_maaser", countedCents: null, updatedAt: "" }));
    const l = maaserLedger({ ...base, prepared: [gift, potGift], marks, from: "2026-01-01", to: "2026-12-31" });
    expect(l.givenFromCardsCents).toBe(0);
    expect(l.givenFromPotCents).toBe(0);
  });
  test("a refund on a Charity row lowers given from cards", () => {
    const l = maaserLedger({ ...base, prepared: [row("chk", "2026-10-08", -60000, "Charity"), row("chk", "2026-10-12", 10000, "Charity")], from: "2026-10-01", to: "2026-10-31" });
    expect(l.givenFromCardsCents).toBe(50000);
  });
  test("a mark on a row of the wrong role changes nothing", () => {
    const groceries = row("chk", "2026-10-08", -5000, "Groceries");
    const transfer = row("chk", "2026-10-08", 130000, "Paychecks", { isTransfer: true });
    const marks: MaaserMark[] = [
      { sourceTransactionId: groceries.sourceTransactionId, kind: "not_maaser", countedCents: null, updatedAt: "" },
      { sourceTransactionId: transfer.sourceTransactionId, kind: "income", countedCents: 1, updatedAt: "" },
    ];
    const l = maaserLedger({ ...base, prepared: [groceries, transfer, row("chk", "2026-10-09", -1000, "Charity")], marks, from: "2026-10-01", to: "2026-10-31" });
    expect(l.givenFromCardsCents).toBe(1000);
    expect(l.countedIncomeCents).toBe(0);
  });
  test("an income mark on a gift row leaves the gift counted", () => {
    const gift = row("chk", "2026-10-08", -5000, "Charity");
    const marks: MaaserMark[] = [{ sourceTransactionId: gift.sourceTransactionId, kind: "income", countedCents: null, updatedAt: "" }];
    expect(maaserLedger({ ...base, prepared: [gift], marks, from: "2026-10-01", to: "2026-10-31" }).givenFromCardsCents).toBe(5000);
  });
  test("rows outside the window are left out; a window with nothing is all zeros", () => {
    const l = maaserLedger({ ...base, prepared: [row("chk", "2026-10-08", -60000, "Charity"), row("pot", "2026-10-02", 90000, "Maaser")], from: "2025-01-01", to: "2025-12-31" });
    expect(l).toMatchObject({ from: "2025-01-01", to: "2025-12-31", owedCents: 0, setAsideCents: 0, givenCents: 0, reimbursedCents: 0, potOwesYouCents: 0, beyondMaaserCents: 0 });
  });
  test("given beyond the pot: how far card gifts awaiting a payback outrun what the pot can pay", () => {
    const prepared = [row("chk", "2026-10-08", -300000, "Charity")];
    expect(maaserLedger({ ...base, prepared, from: "2026-10-01", to: "2026-10-31" }).beyondMaaserCents).toBe(30000);
    expect(maaserLedger({ ...base, prepared, availableCents: null, from: "2026-10-01", to: "2026-10-31" }).beyondMaaserCents).toBeNull();
  });
});

describe("maaserLedgerView", () => {
  test("the live row's balance less the floor, the ledger over the window; an archived row alone gives no balance; no pot account gives a ledger with no account", () => {
    const OLD: Account = { ...POT, id: "old", name: "Giving (...4321)", archived: true, balanceCents: 99 };
    const prepared = [row("old", "2026-03-02", 60000, "Maaser"), row("pot", "2026-10-02", 90000, "Maaser")];
    const v = maaserLedgerView({ accounts: [CHK, POT, OLD], prepared, mapping: {}, marks: [], maaserRate: 0.1, floorCents: 150000, from: "2026-01-01", to: "2026-10-20" })!;
    expect(v.account?.name).toBe("Giving");
    expect(v.availableCents).toBe(270000);
    expect(v.ledger.setAsideCents).toBe(150000);
    expect(maaserLedgerView({ accounts: [CHK, OLD], prepared, mapping: {}, marks: [], maaserRate: 0.1, floorCents: 150000, from: "2026-01-01", to: "2026-10-20" })!.availableCents).toBeNull();
    expect(maaserLedgerView({ accounts: [CHK], prepared, mapping: {}, marks: [], maaserRate: 0.1, floorCents: 0, from: "2026-01-01", to: "2026-10-20" })?.account).toBeNull();
  });
});

describe("a pot flagged on the partner's account is not the owner's", () => {
  const PARTNER_POT: Account = { ...POT, id: "partner-pot", owner: "partner" };
  test("its gift and deposit sit in no ledger figure and take no mark", () => {
    const gift = row("partner-pot", "2026-10-18", -10000, null, { description: "ZELLE PAYMENT TO A CHARITY" });
    const pay = row("partner-pot", "2026-10-02", 10000, "Maaser");
    expect(maaserFiguresOf(gift, [CHK, PARTNER_POT], {})).toEqual([]);
    expect(maaserFiguresOf(pay, [CHK, PARTNER_POT], {})).toEqual([]);
    expect(maaserRole(gift, [CHK, PARTNER_POT], {})).toBeNull();
  });
});

describe("a not-counted mark on money into or out of the pot (a bonus paid into the pot by mistake)", () => {
  const mk = (t: NormalizedTxn): MaaserMark => ({ sourceTransactionId: t.sourceTransactionId, kind: "not_maaser", countedCents: null, updatedAt: "" });
  test("a marked deposit leaves income and set aside; a marked move back leaves paid back; unmarked rows still count", () => {
    const bonus = row("pot", "2025-09-06", 100000, "Maaser");
    const back = row("pot", "2025-09-08", -90000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" });
    const refill = row("pot", "2025-09-10", 20000, "Transfer", { isTransfer: true, transferPartnerAccountId: "chk" });
    expect(maaserFiguresOf(bonus, [CHK, POT], {}, mk(bonus))).toEqual([]);
    expect(maaserFiguresOf(back, [CHK, POT], {}, mk(back))).toEqual([]);
    expect(maaserFiguresOf(refill, [CHK, POT], {}, mk(refill))).toEqual([]);
    const l = maaserLedger({ prepared: [bonus, back, refill, row("pot", "2025-10-01", 5000, "Maaser")], accounts: [CHK, POT], mapping: {}, marks: [mk(bonus), mk(back)], maaserRate: 0.1, from: "2025-01-01", to: "2025-12-31", availableCents: null });
    expect(l.setAsideCents).toBe(25000);
    expect(l.countedIncomeCents).toBe(5000);
    expect(l.reimbursedCents).toBe(0);
  });
  test("an income mark on a pay deposit still only changes the income it counts", () => {
    const pay = row("pot", "2025-10-07", 70000, "Maaser");
    const part: MaaserMark = { sourceTransactionId: pay.sourceTransactionId, kind: "income", countedCents: null, updatedAt: "" };
    expect(maaserFiguresOf(pay, [CHK, POT], {}, part).sort()).toEqual(["income", "setAside"]);
  });
});

