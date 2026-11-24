// tests/domain/sankey.test.ts -- the sums behind the "Where pay goes" Sankey (lane contracts,
// section 3, "What the Sankey sums"). Every band must be a total the app already keeps, every
// node must balance, and the pay entering the bank must be the pay that arrived. Invented figures.
import { describe, expect, test } from "vitest";
import { buildPayFlow, flowOrder, GAP_LABEL, type PayFlow, type PayFlowInput } from "../../src/domain/sankey";
import { rollupMonthly } from "../../src/domain/rollups";
import { cashFlowByMonth } from "../../src/domain/reports";
import { currentSalaryBreakdown, type SalaryBreakdown } from "../../src/domain/salary";
import { maaserLedger, type MaaserLedger } from "../../src/domain/maaser-pot";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import { demoCharityPot, demoSalary } from "../demo";

const CHK: Account = { id: "chk", name: "Checking", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" };
const SAV: Account = { ...CHK, id: "sav", name: "Savings" };
const POT: Account = { ...CHK, id: "pot", name: "Giving", includeInSpend: false, maaserPot: true };
let n = 0;
const row = (date: string, amountCents: number, sourceCategory: string | null, over: Partial<NormalizedTxn> = {}): NormalizedTxn => ({
  sourceTransactionId: `t${++n}`, accountId: "chk", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over,
});
const M = "2026-10";
const d = (day = 5) => `${M}-${String(day).padStart(2, "0")}`;

/** The plan's month: pay 500000, rent 200000, groceries 80000 with a 5000 refund, saving 50000, an own-account transfer. */
function baseRows(): NormalizedTxn[] {
  return [
    row(d(1), 500000, "Paychecks"),
    row(d(2), -200000, "Rent"),
    row(d(3), -80000, "Groceries"),
    row(d(4), 5000, "Groceries"),
    row(d(6), -50000, "Investing"),
    row(d(7), -30000, "Transfer", { isTransfer: true, transferPartnerAccountId: "sav" }),
    row(d(7), 30000, "Transfer", { accountId: "sav", isTransfer: true, transferPartnerAccountId: "chk" }),
  ];
}

function input(prepared: NormalizedTxn[], over: Partial<PayFlowInput> = {}): PayFlowInput {
  return { prepared, accounts: [CHK, SAV, POT], mapping: {}, from: M, to: M, pot: null, potLedger: null, paycheck: null, showPaycheck: false, ...over };
}

const cents = (f: PayFlow, from: string, to: string) => f.links.find((l) => l.from === from && l.to === to)?.cents;
const inOf = (f: PayFlow, id: string) => f.links.filter((l) => l.to === id).reduce((s, l) => s + l.cents, 0);
const outOf = (f: PayFlow, id: string) => f.links.filter((l) => l.from === id).reduce((s, l) => s + l.cents, 0);
const ids = (f: PayFlow) => f.nodes.map((x) => x.id);

/** Every node that has both inflows and outflows takes in exactly what it sends on; no zero or negative band. */
function balanced(f: PayFlow) {
  for (const l of f.links) expect(l.cents, `${l.from}->${l.to}`).toBeGreaterThan(0);
  for (const l of f.links) expect(Number.isInteger(l.cents), `${l.from}->${l.to}`).toBe(true);
  for (const node of f.nodes) {
    const i = inOf(f, node.id), o = outOf(f, node.id);
    if (i > 0 && o > 0) expect(i, node.id).toBe(o);
    expect(i + o, `${node.id} has a band`).toBeGreaterThan(0);
  }
  expect(new Set(ids(f)).size).toBe(f.nodes.length);
  for (const l of f.links) expect(ids(f)).toEqual(expect.arrayContaining([l.from, l.to]));
}

/** Annual Salary figures, invented: taxes split between payroll and federal. */
function breakdown(over: Partial<SalaryBreakdown> = {}): SalaryBreakdown {
  return {
    grossAnnualCents: 12000000, ficaAnnualCents: 900000, federalAnnualCents: 1500000, afterTaxAnnualCents: 9600000,
    charityAnnualCents: 0, premiumAnnualCents: 600000, takeHomeAnnualCents: 9000000,
    otherGrossAnnualCents: 0, otherNetAnnualCents: 0, otherTaxesAnnualCents: 0, ...over,
  };
}
const ledger = (setAsideCents: number, reimbursedCents = 0): MaaserLedger => ({
  from: `${M}-01`, to: `${M}-31`, countedIncomeCents: 0, owedCents: 0, setAsideCents, givenFromCardsCents: 0, givenFromPotCents: 0,
  givenCents: 0, reimbursedCents, notYetSetAsideCents: 0, potOwesYouCents: 0, beyondMaaserCents: null,
});

describe("buildPayFlow: the bank view", () => {
  test("every band is a real total: bank in equals the pay rows, each category band equals its spend", () => {
    const f = buildPayFlow(input(baseRows()));
    expect(cents(f, "in:Paychecks", "bank")).toBe(500000);
    expect(inOf(f, "bank")).toBe(500000);
    expect(cents(f, "bank", "cat:Rent")).toBe(200000);
    expect(cents(f, "bank", "cat:Groceries")).toBe(75000);
    expect(ids(f)).not.toContain("in:refunds");
    expect(f.showsPaycheck).toBe(false);
  });

  test("a transfer between your own accounts is not drawn", () => {
    const before = buildPayFlow(input(baseRows()));
    const after = buildPayFlow(input([...baseRows(),
      row(d(9), -90000, "Transfer", { isTransfer: true, transferPartnerAccountId: "sav" }),
      row(d(9), 90000, "Transfer", { accountId: "sav", isTransfer: true, transferPartnerAccountId: "chk" })]));
    expect(after).toEqual(before);
  });

  test("saving is a band and left over is what remains", () => {
    const f = buildPayFlow(input(baseRows()));
    expect(cents(f, "bank", "saving")).toBe(50000);
    expect(cents(f, "bank", "left-over")).toBe(500000 - 200000 - 75000 - 50000);
    expect(ids(f)).not.toContain("from-savings");
    balanced(f);
  });

  test("when more went out than came in, From savings enters on the left and there is no Left over", () => {
    const f = buildPayFlow(input([row(d(1), 100000, "Paychecks"), row(d(2), -200000, "Rent")]));
    expect(cents(f, "from-savings", "bank")).toBe(100000);
    expect(ids(f)).not.toContain("left-over");
    expect(f.nodes.filter((x) => x.kind === "from-savings")).toHaveLength(1);
    balanced(f);
  });

  test("a net withdrawal from savings enters on the left as From savings, never a negative saving band", () => {
    const f = buildPayFlow(input([row(d(1), 500000, "Paychecks"), row(d(2), -200000, "Rent"), row(d(3), -20000, "Investing"), row(d(4), 70000, "Investing")]));
    expect(ids(f)).not.toContain("saving");
    expect(cents(f, "from-savings", "bank")).toBe(50000);
    expect(cents(f, "bank", "left-over")).toBe(350000);
    balanced(f);
  });

  test("a withdrawal and a shortfall in one period share the one From savings node", () => {
    // Net withdrawal 50000, then spending 100000 beyond pay plus that withdrawal.
    const f = buildPayFlow(input([row(d(1), 100000, "Paychecks"), row(d(2), -250000, "Rent"), row(d(4), 50000, "Investing")]));
    expect(cents(f, "from-savings", "bank")).toBe(150000);
    expect(f.nodes.filter((x) => x.kind === "from-savings")).toHaveLength(1);
    expect(ids(f)).not.toContain("left-over");
    balanced(f);
  });

  test("a category whose refunds exceed its spend is not drawn negative and its surplus counts as money in", () => {
    const f = buildPayFlow(input([row(d(1), 500000, "Paychecks"), row(d(2), -2000, "Groceries"), row(d(3), 5000, "Groceries")]));
    expect(ids(f)).not.toContain("cat:Groceries");
    expect(cents(f, "in:refunds", "bank")).toBe(3000);
    expect(cents(f, "bank", "left-over")).toBe(503000);
    balanced(f);
  });

  test("an empty period gives no nodes and no links", () => {
    const f = buildPayFlow(input([row("2026-08-05", 500000, "Paychecks")], { paycheck: breakdown(), showPaycheck: false }));
    expect(f.nodes).toEqual([]);
    expect(f.links).toEqual([]);
  });

  test("left over and From savings reconcile to the cash-flow rollup to the cent, other income and refunds included", () => {
    const rows = [...baseRows(), row(d(10), 12345, "Interest"), row(d(11), 25000, "Other Income"),
      row(d(12), -999, "Dining"), row(d(13), 1500, "Dining"), row("2026-09-30", -77777, "Rent"), row("2026-11-01", 88888, "Paychecks")];
    const f = buildPayFlow(input(rows));
    const month = cashFlowByMonth(rollupMonthly(rows, [CHK, SAV, POT], {})).find((m) => m.period === M)!;
    expect(inOf(f, "bank") - (cents(f, "from-savings", "bank") ?? 0)).toBe(month.incomeCents + month.investmentIncomeCents + 501);
    expect((cents(f, "bank", "left-over") ?? 0) - (cents(f, "from-savings", "bank") ?? 0)).toBe(month.netCents - month.savingCents);
    balanced(f);
  });
});

describe("buildPayFlow: the charity pot", () => {
  const potRows = () => [
    ...baseRows(),
    row(d(15), 40000, "Paychecks", { accountId: "pot" }),          // pay straight into the pot
    row(d(16), -10000, "Charity", { accountId: "pot" }),           // a gift paid from the pot
    row(d(17), -15000, "Charity"),                                 // given by card
  ];

  test("with a pot account the pot band is what was set aside and pay deposited into the pot counts as money in", () => {
    const f = buildPayFlow(input(potRows(), { pot: demoCharityPot(), potLedger: ledger(30000) }));
    expect(cents(f, "in:pot-pay", "bank")).toBe(40000);
    expect(cents(f, "bank", "pot")).toBe(30000);
    expect(cents(f, "bank", "cat:Charity")).toBe(15000);
    expect(cents(f, "bank", "left-over")).toBe(540000 - 200000 - 75000 - 50000 - 30000 - 15000);
    balanced(f);
  });

  test("a payback from the pot lowers the pot band, so the repaid gift leaves the bank once", () => {
    const f = buildPayFlow(input(potRows(), { pot: demoCharityPot(), potLedger: ledger(30000, 5000) }));
    expect(cents(f, "bank", "pot")).toBe(25000);
    expect(ids(f)).not.toContain("from-pot");
    expect(cents(f, "bank", "left-over")).toBe(540000 - 200000 - 75000 - 50000 - 25000 - 15000);
    balanced(f);
  });

  test("paybacks beyond the set-aside draw no pot band and come in on the left from the pot", () => {
    const f = buildPayFlow(input(potRows(), { pot: demoCharityPot(), potLedger: ledger(10000, 25000) }));
    expect(ids(f)).not.toContain("pot");
    expect(cents(f, "from-pot", "bank")).toBe(15000);
    expect(f.nodes.find((x) => x.id === "from-pot")!.label).toBe(`From ${demoCharityPot().name}`);
    expect(cents(f, "bank", "left-over")).toBe(540000 + 15000 - 200000 - 75000 - 50000 - 15000);
    balanced(f);
  });

  test("four months across the year end, one without pay, with the pot's own ledger: every band hand-checked", () => {
    const rows = [
      row("2025-10-20", 999999, "Paychecks"), row("2026-03-02", 888888, "Paychecks"),            // outside the period
      ...["2025-11-01", "2025-12-01", "2026-02-01"].map((day) => row(day, 250000, "Paychecks")), // January unpaid
      ...["2025-11-03", "2025-12-03", "2026-01-03", "2026-02-03"].map((day) => row(day, -100000, "Rent")),
      row("2025-12-15", 30000, "Paychecks", { accountId: "pot" }),                               // pay into the pot
      row("2026-01-10", -12000, "Charity", { accountId: "pot" }),                                // a gift from the pot
      row("2026-01-11", -8000, "Charity"),                                                       // a gift by card
      row("2026-02-12", -5000, "Transfer", { accountId: "pot", isTransfer: true, transferPartnerAccountId: "chk" }), // the pot pays the card gift back
      row("2026-02-12", 5000, "Transfer", { isTransfer: true, transferPartnerAccountId: "pot" }),
      row("2025-11-20", -30000, "Groceries"), row("2025-11-21", 2000, "Groceries"),
      row("2025-12-31", 1111, "Interest"), row("2026-01-31", -500, "Other Income"),
    ];
    const pot = demoCharityPot();
    const potLedger = maaserLedger({ prepared: rows, accounts: [CHK, SAV, POT], mapping: {}, marks: [], maaserRate: 0, pot, from: "2025-11-01", to: "2026-02-28", availableCents: null });
    const paycheck = breakdown({ grossAnnualCents: 10000001, otherGrossAnnualCents: 2000000, ficaAnnualCents: 765007, federalAnnualCents: 1200003, otherTaxesAnnualCents: 120001, premiumAnnualCents: 360001 });
    const at = (showPaycheck: boolean) => buildPayFlow(input(rows, { from: "2025-11", to: "2026-02", pot, potLedger, paycheck, showPaycheck }));
    const f = at(true);
    expect(outOf(f, "gross")).toBe(4000000);                 // round(12000001 x 4 / 12)
    expect(cents(f, "gross", "taxes")).toBe(695004);
    expect(cents(f, "gross", "benefits")).toBe(120000);
    expect(cents(f, "gross", "bank")).toBe(780000);          // 3 x 250000 + 30000 into the pot
    expect(cents(f, "gross", "gap")).toBe(4000000 - 695004 - 120000 - 780000);
    expect(cents(f, "in:Interest", "bank")).toBe(1111);
    expect(cents(f, "bank", "cat:Rent")).toBe(400000);
    expect(cents(f, "bank", "cat:Charity")).toBe(8000);
    expect(cents(f, "bank", "cat:Groceries")).toBe(28000);
    expect(cents(f, "bank", "cat:Other Income")).toBe(500);
    expect(cents(f, "bank", "pot")).toBe(25000);             // 30000 set aside less the 5000 payback
    expect(cents(f, "bank", "left-over")).toBe(781111 - 400000 - 8000 - 28000 - 500 - 25000);
    expect(cents(at(false), "bank", "left-over")).toBe(cents(f, "bank", "left-over"));
    balanced(f);
  });

  test("without a pot account, or with the pot off, Charity is an ordinary category band", () => {
    const none = buildPayFlow(input(potRows(), { accounts: [CHK, SAV, { ...POT, maaserPot: false, includeInSpend: true }], pot: null, potLedger: null }));
    expect(cents(none, "bank", "cat:Charity")).toBe(25000);
    expect(ids(none)).not.toContain("pot");
    balanced(none);
    const off = buildPayFlow(input(potRows(), { pot: { ...demoCharityPot(), on: false }, potLedger: ledger(30000) }));
    expect(cents(off, "bank", "cat:Charity")).toBe(25000);
    expect(ids(off)).not.toContain("pot");
    balanced(off);
  });
});

describe("buildPayFlow: the paycheck view", () => {
  const pay = (arrived: number[], over: Partial<PayFlowInput> = {}) =>
    buildPayFlow(input([...arrived.map((c, i) => row(d(1 + i), c, "Paychecks")), row(d(2), -200000, "Rent"), row(d(3), 2500, "Other Income")],
      { paycheck: breakdown(), showPaycheck: true, ...over }));

  test("the paycheck view adds gross, taxes and benefits from the Salary figures for the same period", () => {
    const f = pay([750000]);
    expect(f.showsPaycheck).toBe(true);
    expect(cents(f, "gross", "taxes")).toBe(200000);
    expect(cents(f, "gross", "benefits")).toBe(50000);
    expect(outOf(f, "gross")).toBe(1000000);
    expect(ids(f)).not.toContain("gap");
    expect(ids(f)).not.toContain("in:Paychecks");
    expect(cents(f, "in:Other Income", "bank")).toBe(2500);
    for (const l of f.links) expect(l.modelled, `${l.from}->${l.to}`).toBe(l.from === "gross" || l.from === "gap" || l.to === "gap");
    balanced(f);
  });

  test("less pay arrived than modelled: gross credits the bank with what arrived and the rest goes to the gap", () => {
    const f = pay([700000]);
    expect(cents(f, "gross", "bank")).toBe(700000);
    expect(cents(f, "gross", "gap")).toBe(50000);
    expect(inOf(f, "bank") - 2500).toBe(700000);
    expect(outOf(f, "gross")).toBe(1000000);
    expect(f.nodes.find((x) => x.id === "gap")).toEqual({ id: "gap", label: GAP_LABEL, kind: "gap", modelled: true });
    balanced(f);
  });

  test("more pay arrived than modelled: gross credits the bank with the modelled take-home and only the excess enters along the gap", () => {
    const f = pay([800000]);
    expect(cents(f, "gross", "bank")).toBe(750000);
    expect(cents(f, "gap", "bank")).toBe(50000);
    expect(inOf(f, "bank") - 2500).toBe(800000);
    expect(outOf(f, "gross")).toBe(1000000);
    balanced(f);
  });

  test("left over is the same in both views", () => {
    for (const arrived of [700000, 800000]) {
      const bank = pay([arrived], { showPaycheck: false });
      const full = pay([arrived]);
      expect(cents(full, "bank", "left-over")).toBe(cents(bank, "bank", "left-over"));
    }
  });

  test("a second W-2 paycheck is in gross, so it never shows as a gap", () => {
    const f = pay([560000, 190000], { paycheck: breakdown({ grossAnnualCents: 9000000, otherGrossAnnualCents: 3000000 }) });
    expect(outOf(f, "gross")).toBe(1000000);
    expect(cents(f, "gross", "bank")).toBe(750000);
    expect(ids(f)).not.toContain("gap");
    balanced(f);
  });

  test("other taxes withheld are in the taxes band, and an amount typed as monthly net stays out of gross", () => {
    const f = pay([700000], { paycheck: breakdown({ otherTaxesAnnualCents: 600000, otherNetAnnualCents: 1200000 }) });
    expect(cents(f, "gross", "taxes")).toBe(250000);
    expect(outOf(f, "gross")).toBe(1000000);
    expect(cents(f, "gross", "bank")).toBe(700000);
    expect(ids(f)).not.toContain("gap");
    balanced(f);
  });

  test("with a partner's salary on its own single return, a year's take-home band is the Salary figures' after tax less benefits", () => {
    const a = { ...demoSalary(), tax: { filingStatus: "single" as const, children: 0 }, premiumMonthlyCents: 40000, afterTaxBenefitsMonthlyCents: 0,
      additionalSalary: { kind: "w2" as const, grossAnnualCents: 3000000, fromPeriod: "2026-01" }, firmTaxes: { federalAnnualCents: null, payrollAnnualCents: null, otherAnnualCents: 240000 } };
    const b = currentSalaryBreakdown(9000000, 0, a);
    const rows = Array.from({ length: 12 }, (_, i) => row(`2026-${String(i + 1).padStart(2, "0")}-01`, 600000, "Paychecks"));
    const f = buildPayFlow(input(rows, { from: "2026-01", to: "2026-12", paycheck: b, showPaycheck: true }));
    const takeHome = b.afterTaxAnnualCents - b.premiumAnnualCents;
    expect(cents(f, "gross", "taxes")).toBe(b.ficaAnnualCents + b.federalAnnualCents + 240000);
    expect((cents(f, "gross", "bank") ?? 0) + (cents(f, "gross", "gap") ?? 0)).toBe(takeHome);
    expect(inOf(f, "bank")).toBe(7200000);
    balanced(f);
  });

  test("pay into the pot counts as pay that arrived", () => {
    const f = buildPayFlow(input([row(d(1), 700000, "Paychecks"), row(d(2), 50000, "Paychecks", { accountId: "pot" })],
      { paycheck: breakdown(), showPaycheck: true, pot: demoCharityPot(), potLedger: ledger(50000) }));
    expect(cents(f, "gross", "bank")).toBe(750000);
    expect(ids(f)).not.toContain("gap");
    expect(ids(f)).not.toContain("in:pot-pay");
    balanced(f);
  });

  test("the paycheck switch is off when there are no Salary figures", () => {
    const f = buildPayFlow(input(baseRows(), { paycheck: null, showPaycheck: true }));
    expect(f).toEqual(buildPayFlow(input(baseRows())));
    expect(f.showsPaycheck).toBe(false);
  });

  test("a year spans its months and a month spans one", () => {
    const rows = [row("2025-12-15", 999999, "Paychecks"), ...Array.from({ length: 12 }, (_, i) => row(`2026-${String(i + 1).padStart(2, "0")}-10`, 700000, "Paychecks")), row("2027-01-02", 888888, "Paychecks")];
    // Annual figures chosen so a month does not divide evenly: one rounding per figure over the period, never per month.
    const odd = breakdown({ grossAnnualCents: 12000005, ficaAnnualCents: 900007, federalAnnualCents: 1500000, premiumAnnualCents: 600005 });
    const year = buildPayFlow(input(rows, { from: "2026-01", to: "2026-12", paycheck: odd, showPaycheck: true }));
    expect(inOf(year, "bank")).toBe(8400000);
    expect(outOf(year, "gross")).toBe(12000005);
    expect(cents(year, "gross", "taxes")).toBe(2400007);
    expect(cents(year, "gross", "benefits")).toBe(600005);
    const quarter = buildPayFlow(input(rows, { from: "2026-01", to: "2026-03", paycheck: odd, showPaycheck: true }));
    expect(outOf(quarter, "gross")).toBe(Math.round(12000005 / 4));
    expect(cents(quarter, "gross", "taxes")).toBe(Math.round(2400007 / 4));
    balanced(quarter);
    const month = buildPayFlow(input(rows, { from: "2026-06", to: "2026-06" }));
    expect(inOf(month, "bank")).toBe(700000);
  });
});

describe("flowOrder", () => {
  test("inflows, the bank hub, spending largest first, then pot, saving and left over", () => {
    const f = buildPayFlow(input([...baseRows(), row(d(20), -90000, "Dining"), row(d(21), 40000, "Paychecks", { accountId: "pot" })],
      { pot: demoCharityPot(), potLedger: ledger(30000) }));
    expect(flowOrder(f)).toEqual(["in:Paychecks", "in:pot-pay", "bank", "cat:Rent", "cat:Dining", "cat:Groceries", "pot", "saving", "left-over"]);
    expect(ids(f)).toEqual(flowOrder(f));
  });
});
