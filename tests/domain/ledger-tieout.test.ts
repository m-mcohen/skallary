// tests/domain/ledger-tieout.test.ts
//
// The rule the click-through feature is built on: a number you can click must
// equal the total of the ledger it opens, to the cent.
//
// This is a property test over generated data rather than a handful of
// hand-picked rows, because the ways a Reports figure and a transaction list
// drift apart are exactly the rows nobody thinks to write by hand: a refund, a
// transfer, an account that is not counted, a planning category that carries
// income from one raw category and spending from another.
import { describe, expect, test } from "vitest";
import { rollupMonthly } from "../../src/domain/rollups";
import { cashFlowByMonth, incomeByCategoryOverTime, spendingByCategoryOverTime } from "../../src/domain/reports";
import { monthBounds } from "../../src/domain/period";
import { EMPTY_FILTER, filterRows, ledgerTotal, toRows, withRunningTotal, type TxnRow } from "../../src/domain/transactions-view";
import type { Account, NormalizedTxn } from "../../src/domain/types";

/** Deterministic PRNG: the same 400 rows on every run, on every machine. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const account = (id: string, includeInSpend: boolean): Account =>
  ({
    id,
    name: id,
    type: "depository",
    institution: null,
    currency: "USD",
    isOwned: true,
    includeInSpend,
    owner: "me",
  }) as Account;

const accounts = [account("checking", true), account("card", true), account("not-counted", false)];

// "Bonus Income" is income by its RAW name; "Gifts" is spending. Both map to
// the planning category "Misc", so "Misc" carries both kinds.
const mapping: Record<string, string> = { "Bonus Income": "Misc", Gifts: "Misc", "Whole Foods": "Groceries" };
// "Credit Card Payment" is a transfer by name: it must leave both sides alike.
const SPEND = ["Groceries", "Whole Foods", "Gifts", "Utilities", "Dining", "Credit Card Payment"];
const INCOME = ["Paychecks", "Other Income", "Bonus Income"];
const MONTHS = ["2023-12", "2024-01", "2024-02", "2024-03", "2024-04"]; // includes a leap February
const DAYS_IN: Record<string, number> = { "2023-12": 31, "2024-01": 31, "2024-02": 29, "2024-03": 31, "2024-04": 30 };

function generate(): NormalizedTxn[] {
  const rnd = mulberry32(20260920);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const out: NormalizedTxn[] = [];
  for (let i = 0; i < 400; i++) {
    const month = pick(MONTHS);
    // Weight the edges so the first and last day of each month are well covered.
    const edge = rnd();
    const day = edge < 0.15 ? 1 : edge < 0.3 ? DAYS_IN[month] : 1 + Math.floor(rnd() * DAYS_IN[month]);
    const isIncome = rnd() < 0.2;
    const isTransfer = rnd() < 0.1;
    const isRefund = !isIncome && rnd() < 0.12;
    const cents = 100 + Math.floor(rnd() * 250000);
    out.push({
      sourceTransactionId: `t${String(i).padStart(4, "0")}`,
      accountId: pick(accounts).id,
      date: `${month}-${String(day).padStart(2, "0")}`,
      amountCents: isIncome || isRefund ? cents : -cents,
      sourceCategory: isIncome ? pick(INCOME) : pick(SPEND),
      merchant: null,
      isTransfer,
      sourceUpdatedAt: null,
    });
  }
  return out;
}

const txns = generate();
const rows = toRows(txns, accounts, mapping);
const rollups = rollupMonthly(txns, accounts, mapping);
const scoped = { ...EMPTY_FILTER, countedAccountsOnly: true };

/**
 * A one-sided ledger must LIST only that side, and the running total a reader
 * follows down the page must end on the figure. Checking the header total alone
 * is not enough: ledgerTotal reads each side separately, so a list polluted
 * with the other side's rows would still show a matching header.
 */
function expectListMatchesFigure(ledger: TxnRow[], kind: "expense" | "income", figureCents: number, label: string) {
  expect(ledger.every((row) => row.kind === kind), `${label}: a row of the other kind is listed`).toBe(true);
  const last = withRunningTotal(ledger, kind).at(-1)?.runningCents ?? 0;
  expect(last, `${label}: the running total does not end on the figure`).toBe(figureCents);
}

describe("the generated data really contains the hard cases", () => {
  test("transfers, an uncounted account, refunds, and a category carrying both kinds in one month", () => {
    expect(txns.some((t) => t.isTransfer)).toBe(true);
    expect(txns.some((t) => t.accountId === "not-counted" && !t.isTransfer)).toBe(true);
    expect(txns.some((t) => t.amountCents > 0 && SPEND.includes(t.sourceCategory ?? ""))).toBe(true);
    const miscKinds = new Map<string, Set<string>>();
    for (const r of rollups) {
      if (r.planningCategory !== "Misc") continue;
      miscKinds.set(r.period, (miscKinds.get(r.period) ?? new Set()).add(r.kind));
    }
    expect([...miscKinds.values()].some((kinds) => kinds.size === 2)).toBe(true);
    expect(rollups.length).toBeGreaterThan(20);
    expect(txns.some((t) => t.sourceCategory === "Credit Card Payment" && !t.isTransfer)).toBe(true);
    expect(rollups.some((r) => r.planningCategory === "Credit Card Payment")).toBe(false);
  });
});

describe("every Reports figure equals the total of the ledger it links to", () => {
  test("each category-by-month cell", () => {
    for (const r of rollups) {
      const { from, to } = monthBounds(r.period);
      const ledger = filterRows(rows, { ...scoped, categories: [r.planningCategory], kind: r.kind, from, to });
      const total = ledgerTotal(ledger);
      const got = r.kind === "expense" ? total.expenseCents : total.incomeCents;
      expect(got, `${r.period} ${r.planningCategory} ${r.kind}`).toBe(r.amountCents);
      expectListMatchesFigure(ledger, r.kind, r.amountCents, `${r.period} ${r.planningCategory} ${r.kind}`);
    }
  });

  test("each category total across all months", () => {
    for (const [kind, result] of [
      ["expense", spendingByCategoryOverTime(rollups)],
      ["income", incomeByCategoryOverTime(rollups)],
    ] as const) {
      for (const s of result.series) {
        const ledger = filterRows(rows, { ...scoped, categories: [s.category], kind });
        const total = ledgerTotal(ledger);
        expect(kind === "expense" ? total.expenseCents : total.incomeCents, `${s.category} ${kind}`).toBe(s.total);
        expectListMatchesFigure(ledger, kind, s.total, `${s.category} ${kind}`);
      }
    }
  });

  test("several categories at once, the way the Other row folds them", () => {
    const series = spendingByCategoryOverTime(rollups).series;
    const folded = series.slice(2);
    expect(folded.length).toBeGreaterThan(1);
    const total = ledgerTotal(filterRows(rows, { ...scoped, categories: folded.map((s) => s.category), kind: "expense" }));
    expect(total.expenseCents).toBe(folded.reduce((sum, s) => sum + s.total, 0));
  });

  test("each month's income, expense, and net on the cash-flow tab", () => {
    const months = cashFlowByMonth(rollups);
    expect(months.length).toBe(MONTHS.length);
    for (const m of months) {
      const { from, to } = monthBounds(m.period);
      expect(ledgerTotal(filterRows(rows, { ...scoped, kind: "income", from, to })).incomeCents, `${m.period} income`).toBe(m.incomeCents);
      expect(ledgerTotal(filterRows(rows, { ...scoped, kind: "expense", from, to })).expenseCents, `${m.period} expense`).toBe(m.expenseCents);
      const both = ledgerTotal(filterRows(rows, { ...scoped, from, to }));
      expect(both.netCents, `${m.period} net`).toBe(m.netCents);
      expect(both.incomeCents - both.expenseCents).toBe(both.netCents);
    }
  });
});
