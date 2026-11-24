import { expect, test } from "vitest";
import { computeRunway, drawableLiquidCents, isRetirementAccount } from "../../src/domain/runway";

test("runway crosses zero when cumulative net drains starting liquid", () => {
  const r = computeRunway(100000, [
    { period: "2026-01", netCents: -40000 },
    { period: "2026-02", netCents: -40000 },
    { period: "2026-03", netCents: -40000 },
  ]);
  expect(r.liquidByMonth.map((m) => m.cents)).toEqual([60000, 20000, -20000]);
  expect(r.crossZeroPeriod).toBe("2026-03");
  expect(r.runwayMonths).toBe(3);
});

test("cash-flow positive => no runway limit", () => {
  const r = computeRunway(100000, [{ period: "2026-01", netCents: 5000 }]);
  expect(r.crossZeroPeriod).toBeNull();
  expect(r.runwayMonths).toBeNull();
});

test("drawable liquid: assets add, credit nets, excluded types + excluded accounts skipped", () => {
  const accts = [
    { id: "chk", name: "", type: "checking", institution: null, currency: "USD", isOwned: true, includeInSpend: true },
    { id: "cc", name: "", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true },
    { id: "mtg", name: "", type: "mortgage", institution: null, currency: "USD", isOwned: true, includeInSpend: true },
    { id: "excl", name: "", type: "checking", institution: null, currency: "USD", isOwned: true, includeInSpend: false },
  ];
  const bals = [
    { accountId: "chk", balanceCents: 500000, asOf: "" },
    { accountId: "cc", balanceCents: -80000, asOf: "" }, // card debt (negative)
    { accountId: "mtg", balanceCents: -30000000, asOf: "" },
    { accountId: "excl", balanceCents: 999999, asOf: "" },
  ];
  expect(drawableLiquidCents(accts as any, bals)).toBe(420000); // 500000 - 80000; mortgage + excluded acct skipped
});

test("drawable liquid: the feed's own type strings (brokerage/credit/depository) are recognized", () => {
  // A feed reports type names such as 'brokerage' | 'credit' | 'depository'
  // (not 'checking'/'savings'/'cash'). 'depository' once had no matching
  // ASSET_TYPES substring and was silently excluded from drawableLiquidCents;
  // this guards that.
  const accts = [
    { id: "dep", name: "", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true },
    { id: "brk", name: "", type: "brokerage", institution: null, currency: "USD", isOwned: true, includeInSpend: true },
    { id: "cc", name: "", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true },
  ];
  const bals = [
    { accountId: "dep", balanceCents: 200000, asOf: "" },
    { accountId: "brk", balanceCents: 300000, asOf: "" },
    { accountId: "cc", balanceCents: -50000, asOf: "" },
  ];
  expect(drawableLiquidCents(accts as any, bals)).toBe(450000);
});

test("drawable liquid: retirement (IRA/Roth) brokerage accounts are excluded; taxable brokerage stays", () => {
  // A feed may type IRAs as 'brokerage' like a taxable brokerage — the signal is the
  // NAME. Penalty-locked retirement money is not drawable.
  const accts = [
    { id: "tax", name: "Alex Example - Brokerage Account - ****0606", type: "brokerage", institution: null, currency: "USD", isOwned: true, includeInSpend: true },
    { id: "roth", name: "Alex Example - Roth IRA Brokerage Account - ****0707", type: "brokerage", institution: null, currency: "USD", isOwned: true, includeInSpend: true },
    { id: "trad", name: "Alex Example - Traditional IRA Brokerage Account - ****0808", type: "brokerage", institution: null, currency: "USD", isOwned: true, includeInSpend: true },
    { id: "chk", name: "JOINT CHECKING (...0101)", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true },
  ];
  const bals = [
    { accountId: "tax", balanceCents: 2010000, asOf: "" },
    { accountId: "roth", balanceCents: 1200000, asOf: "" },
    { accountId: "trad", balanceCents: 570000, asOf: "" },
    { accountId: "chk", balanceCents: 500000, asOf: "" },
  ];
  // taxable brokerage + checking only; the two IRAs ($12,000.00 + $5,700.00) dropped.
  expect(drawableLiquidCents(accts as any, bals)).toBe(2010000 + 500000);
  expect(isRetirementAccount(accts[1] as any)).toBe(true);  // Roth IRA
  expect(isRetirementAccount(accts[2] as any)).toBe(true);  // Traditional IRA
  expect(isRetirementAccount(accts[0] as any)).toBe(false); // taxable brokerage
  expect(isRetirementAccount(accts[3] as any)).toBe(false); // checking
});
