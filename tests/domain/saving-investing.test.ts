// tests/domain/saving-investing.test.ts
//
// Saving/Investing is its own bucket: not income, not expense. The rule is CROSSING, not arriving -- money counts as saving
// when it leaves an unflagged account for a flagged one, counted once on the
// leg that leaves. Everything inside a flagged account counts nowhere, which is
// what stops brokerage dividend-reinvestment noise from inflating Interest
// income and Uncategorized spend.
import { describe, expect, test } from "vitest";
import { classifySavings, isSavingCategory, isInvestmentIncomeCategory } from "../../src/domain/savings";
import { matchTransfers } from "../../src/domain/transfers";
import { classify } from "../../src/domain/dedup";
import { rollupMonthly } from "../../src/domain/rollups";
import { cashFlowByMonth, savingsRate } from "../../src/domain/reports";
import { prepareForRollup } from "../../src/domain/pipeline";
import { applyAdjustments } from "../../src/domain/adjustments";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const txn = (over: Partial<NormalizedTxn>): NormalizedTxn =>
  ({
    sourceTransactionId: "t", accountId: "checking", date: "2026-04-12", amountCents: -400000,
    sourceCategory: null, merchant: null, isTransfer: false, sourceUpdatedAt: null, ...over,
  }) as NormalizedTxn;

const acct = (id: string, savingsDestination: string | null = null): Account => ({
  id, name: id, type: "depository", institution: null, currency: "USD",
  isOwned: true, includeInSpend: true, owner: "me", savingsDestination,
});

const ACCOUNTS = [
  acct("checking"),
  acct("moneymarket"),                          // money market: deliberately NOT flagged
  acct("brokerage", "Investing"),
  acct("ira", "Retirement"),
];

/** The real pipeline order for the two steps under test. */
const prep = (txns: NormalizedTxn[]) => classifySavings(matchTransfers(txns), ACCOUNTS);

describe("isSavingCategory", () => {
  test("the two flavors, any case; nothing else", () => {
    expect(isSavingCategory("Investing")).toBe(true);
    expect(isSavingCategory("retirement")).toBe(true);
    expect(isSavingCategory("Investments")).toBe(false);
    expect(isSavingCategory("Interest")).toBe(false);
    expect(isSavingCategory("Transfer")).toBe(false);
  });
});

describe("isInvestmentIncomeCategory", () => {
  test("returns you can spend, not wage income", () => {
    expect(isInvestmentIncomeCategory("Interest")).toBe(true);
    expect(isInvestmentIncomeCategory("Dividends")).toBe(true);
    expect(isInvestmentIncomeCategory("Investment Income")).toBe(true);
    expect(isInvestmentIncomeCategory("Paychecks")).toBe(false);
    expect(isInvestmentIncomeCategory("Business Income")).toBe(false);
  });
});

describe("the crossing rule", () => {
  test("counted ONCE, on the leg leaving the unflagged account", () => {
    const out = prep([
      txn({ sourceTransactionId: "out", accountId: "checking", date: "2026-04-12", amountCents: -400000 }),
      txn({ sourceTransactionId: "in", accountId: "brokerage", date: "2026-04-14", amountCents: 400000 }),
    ]);
    const leaving = out.find((t) => t.sourceTransactionId === "out")!;
    const arriving = out.find((t) => t.sourceTransactionId === "in")!;

    expect(classify(leaving, {})).toEqual({ planningCategory: "Investing", kind: "saving" });
    // The arrival leg is suppressed, or the $4,000 would count twice.
    expect(classify(arriving, {}).kind).toBe("transfer");
  });

  test("saving BEATS the transfer flag the pair matcher already set", () => {
    const out = prep([
      txn({ sourceTransactionId: "out", accountId: "checking", amountCents: -400000 }),
      txn({ sourceTransactionId: "in", accountId: "brokerage", date: "2026-04-14", amountCents: 400000 }),
    ]);
    const leaving = out.find((t) => t.sourceTransactionId === "out")!;
    expect(leaving.isTransfer).toBe(true);          // the matcher flagged it
    expect(classify(leaving, {}).kind).toBe("saving"); // and saving still wins
  });

  test("flagged to flagged counts as ZERO -- rearranging is not saving", () => {
    const out = prep([
      txn({ sourceTransactionId: "out", accountId: "brokerage", amountCents: -400000 }),
      txn({ sourceTransactionId: "in", accountId: "ira", date: "2026-04-13", amountCents: 400000 }),
    ]);
    for (const t of out) expect(classify(t, {}).kind).toBe("transfer");
  });

  test("checking to a money market account stays neutral -- it is cash, not a destination", () => {
    const out = prep([
      txn({ sourceTransactionId: "out", accountId: "checking", amountCents: -400000 }),
      txn({ sourceTransactionId: "in", accountId: "moneymarket", date: "2026-04-13", amountCents: 400000 }),
    ]);
    for (const t of out) expect(classify(t, {}).kind).toBe("transfer");
  });

  test("money market to brokerage IS saving -- it crosses the boundary", () => {
    const out = prep([
      txn({ sourceTransactionId: "out", accountId: "moneymarket", amountCents: -400000 }),
      txn({ sourceTransactionId: "in", accountId: "brokerage", date: "2026-04-13", amountCents: 400000 }),
    ]);
    const leaving = out.find((t) => t.sourceTransactionId === "out")!;
    expect(classify(leaving, {})).toEqual({ planningCategory: "Investing", kind: "saving" });
  });

  test("the flavor comes from the DESTINATION account, not the source", () => {
    const out = prep([
      txn({ sourceTransactionId: "out", accountId: "checking", amountCents: -600000 }),
      txn({ sourceTransactionId: "in", accountId: "ira", date: "2026-04-13", amountCents: 600000 }),
    ]);
    const leaving = out.find((t) => t.sourceTransactionId === "out")!;
    expect(classify(leaving, {}).planningCategory).toBe("Retirement");
  });
});

describe("withdrawals", () => {
  test("money coming back out is NEGATIVE saving, not income", () => {
    const out = prep([
      txn({ sourceTransactionId: "out", accountId: "brokerage", date: "2025-07-01", amountCents: -250000 }),
      txn({ sourceTransactionId: "in", accountId: "checking", date: "2025-07-01", amountCents: 250000 }),
    ]);
    const arriving = out.find((t) => t.sourceTransactionId === "in")!;
    expect(classify(arriving, {})).toEqual({ planningCategory: "Investing", kind: "saving" });

    // Sign: rollups report saving like spend, so a contribution is positive and
    // this withdrawal is negative.
    const rows = rollupMonthly(out, ACCOUNTS, {});
    const saving = rows.find((r) => r.kind === "saving")!;
    expect(saving.amountCents).toBe(-250000);
  });

  test("a month with both nets out", () => {
    const out = prep([
      txn({ sourceTransactionId: "c1", accountId: "checking", date: "2026-04-01", amountCents: -400000 }),
      txn({ sourceTransactionId: "c2", accountId: "brokerage", date: "2026-04-01", amountCents: 400000 }),
      txn({ sourceTransactionId: "w1", accountId: "brokerage", date: "2026-04-20", amountCents: -100000 }),
      txn({ sourceTransactionId: "w2", accountId: "checking", date: "2026-04-20", amountCents: 100000 }),
    ]);
    const rows = rollupMonthly(out, ACCOUNTS, {});
    expect(rows.find((r) => r.kind === "saving")!.amountCents).toBe(300000);
  });
});

describe("the wash rule", () => {
  test("equal and opposite, same account, same day, counts nowhere", () => {
    const out = prep([
      txn({ sourceTransactionId: "a", accountId: "moneymarket", date: "2026-06-30", amountCents: 4500, sourceCategory: "Shopping" }),
      txn({ sourceTransactionId: "b", accountId: "moneymarket", date: "2026-06-30", amountCents: -4500, sourceCategory: "Shopping" }),
    ]);
    for (const t of out) expect(classify(t, {}).kind).toBe("transfer");
    expect(rollupMonthly(out, ACCOUNTS, {})).toEqual([]);
  });

  test("a charge and its same-day refund net out too -- the rule is general", () => {
    const out = prep([
      txn({ sourceTransactionId: "buy", accountId: "checking", date: "2026-06-30", amountCents: -5000, sourceCategory: "Shopping" }),
      txn({ sourceTransactionId: "refund", accountId: "checking", date: "2026-06-30", amountCents: 5000, sourceCategory: "Shopping" }),
    ]);
    expect(rollupMonthly(out, ACCOUNTS, {})).toEqual([]);
  });

  test("different days are NOT a wash -- only same account, same day", () => {
    const out = prep([
      txn({ sourceTransactionId: "a", accountId: "checking", date: "2026-06-30", amountCents: -5000, sourceCategory: "Shopping" }),
      txn({ sourceTransactionId: "b", accountId: "checking", date: "2026-07-02", amountCents: 5000, sourceCategory: "Shopping" }),
    ]);
    expect(out.every((t) => classify(t, {}).kind === "expense")).toBe(true);
  });

  test("does NOT wash against a leg that is already a transfer -- real interest survives", () => {
    // Money market interest is reinvested the same day, and the reinvestment leg already
    // carries the transfer flag. Washing that pair would erase real investment income.
    const out = prep([
      txn({ sourceTransactionId: "int", accountId: "moneymarket", date: "2026-01-30", amountCents: 6500, sourceCategory: "Interest" }),
      txn({ sourceTransactionId: "reinvest", accountId: "moneymarket", date: "2026-01-30", amountCents: -6500, sourceCategory: "Transfer", isTransfer: true }),
    ]);
    const interest = out.find((t) => t.sourceTransactionId === "int")!;
    expect(classify(interest, {}).kind).toBe("investment_income");
    expect(classify(out.find((t) => t.sourceTransactionId === "reinvest")!, {}).kind).toBe("transfer");
  });

  test("interest reinvested the same day stays income -- only the reinvestment is silenced", () => {
    // The SimpleFIN version of the case above: the reinvestment leg arrives
    // with no category, so nothing flags it. Washing the pair would make the
    // interest disappear.
    const out = prep([
      txn({ sourceTransactionId: "int", accountId: "moneymarket", date: "2026-06-30", amountCents: 4500, sourceCategory: "Interest" }),
      txn({ sourceTransactionId: "reinvest", accountId: "moneymarket", date: "2026-06-30", amountCents: -4500, sourceCategory: null }),
    ]);
    expect(classify(out.find((t) => t.sourceTransactionId === "int")!, {}).kind).toBe("investment_income");
    expect(classify(out.find((t) => t.sourceTransactionId === "reinvest")!, {}).kind).toBe("transfer");
  });

  test("but two uncategorised legs still wash each other entirely", () => {
    const out = prep([
      txn({ sourceTransactionId: "a", accountId: "moneymarket", date: "2026-06-30", amountCents: 1500, sourceCategory: null }),
      txn({ sourceTransactionId: "b", accountId: "moneymarket", date: "2026-06-30", amountCents: -1500, sourceCategory: null }),
    ]);
    expect(rollupMonthly(out, ACCOUNTS, {})).toEqual([]);
  });

  test("an unmatched third row of the same amount survives", () => {
    const out = prep([
      txn({ sourceTransactionId: "a", accountId: "checking", date: "2026-06-30", amountCents: -5000, sourceCategory: "Shopping" }),
      txn({ sourceTransactionId: "b", accountId: "checking", date: "2026-06-30", amountCents: 5000, sourceCategory: "Shopping" }),
      txn({ sourceTransactionId: "c", accountId: "checking", date: "2026-06-30", amountCents: -5000, sourceCategory: "Shopping" }),
    ]);
    const survivors = out.filter((t) => classify(t, {}).kind === "expense");
    expect(survivors.map((t) => t.sourceTransactionId)).toEqual(["c"]);
  });
});

describe("everything inside a flagged account counts nowhere", () => {
  test("a dividend reinvestment pair inside the brokerage is silent", () => {
    const out = prep([
      txn({ sourceTransactionId: "div", accountId: "brokerage", date: "2026-06-30", amountCents: 2000, sourceCategory: "Interest" }),
      txn({ sourceTransactionId: "buy", accountId: "brokerage", date: "2026-06-30", amountCents: -2000 }),
    ]);
    expect(rollupMonthly(out, ACCOUNTS, {})).toEqual([]);
  });

  test("even an UNPAIRED row inside a flagged account is silent", () => {
    const out = prep([
      txn({ sourceTransactionId: "solo", accountId: "brokerage", date: "2026-07-14", amountCents: -1000000 }),
    ]);
    expect(classify(out[0], {}).kind).toBe("transfer");
  });
});

describe("the category escape hatch, for legacy rows with no second leg", () => {
  test("a row labelled Investing counts as saving even with no partner leg", () => {
    const out = prep([txn({ sourceTransactionId: "legacy", accountId: "checking", date: "2024-03-01", amountCents: -100000, sourceCategory: "Investing" })]);
    expect(classify(out[0], {})).toEqual({ planningCategory: "Investing", kind: "saving" });
  });

  test("it beats the old transfer flag those rows carry", () => {
    const out = prep([txn({ sourceTransactionId: "legacy", accountId: "checking", date: "2024-03-01", amountCents: -100000, sourceCategory: "Transfer", isTransfer: true })]);
    expect(classify(out[0], { Transfer: "Investing" }).kind).toBe("saving");
  });
});

describe("Investment Income is its own line", () => {
  test("interest in a spendable account is investment income, not wage income", () => {
    const out = prep([txn({ sourceTransactionId: "int", accountId: "moneymarket", date: "2026-04-30", amountCents: 7000, sourceCategory: "Interest" })]);
    expect(classify(out[0], {})).toEqual({ planningCategory: "Interest", kind: "investment_income" });
  });

  test("a paycheck is still ordinary income", () => {
    const out = prep([txn({ sourceTransactionId: "pay", accountId: "checking", amountCents: 500000, sourceCategory: "Paychecks" })]);
    expect(classify(out[0], {}).kind).toBe("income");
  });

  test("the rollup keeps them apart, both positive", () => {
    const out = prep([
      txn({ sourceTransactionId: "int", accountId: "moneymarket", date: "2026-04-30", amountCents: 7000, sourceCategory: "Interest" }),
      txn({ sourceTransactionId: "pay", accountId: "checking", date: "2026-04-30", amountCents: 500000, sourceCategory: "Paychecks" }),
    ]);
    const rows = rollupMonthly(out, ACCOUNTS, {});
    expect(rows.find((r) => r.kind === "investment_income")!.amountCents).toBe(7000);
    expect(rows.find((r) => r.kind === "income")!.amountCents).toBe(500000);
  });
});

describe("the cash flow bottom line", () => {
  const flow = (rows: Parameters<typeof cashFlowByMonth>[0]) => cashFlowByMonth(rows)[0];

  // Left over is earned minus spent. Saving is its own figure; a month that moved $4,000
  // to a brokerage account still left $7,900 over.
  test("Income - Spend = Left over; saving is its own figure", () => {
    const t = flow([
      { period: "2026-04", planningCategory: "Paychecks", kind: "income", amountCents: 1000000 },
      { period: "2026-04", planningCategory: "Rent", kind: "expense", amountCents: 210000 },
      { period: "2026-04", planningCategory: "Investing", kind: "saving", amountCents: 400000 },
    ]);
    expect(t.incomeCents).toBe(1000000);
    expect(t.expenseCents).toBe(210000);
    expect(t.savingCents).toBe(400000);
    expect(t.netCents).toBe(1000000 - 210000);
  });

  test("saving is NOT filed as spending -- the trap the old 'income, else expense' left", () => {
    const t = flow([{ period: "2026-04", planningCategory: "Investing", kind: "saving", amountCents: 400000 }]);
    expect(t.expenseCents).toBe(0);
    expect(t.savingCents).toBe(400000);
  });

  test("investment income counts as money in, on its own line", () => {
    const t = flow([
      { period: "2026-04", planningCategory: "Paychecks", kind: "income", amountCents: 1000000 },
      { period: "2026-04", planningCategory: "Interest", kind: "investment_income", amountCents: 7000 },
    ]);
    expect(t.incomeCents).toBe(1000000);
    expect(t.investmentIncomeCents).toBe(7000);
    expect(t.netCents).toBe(1007000);
  });

  test("savings rate is saving over everything that came in", () => {
    const t = flow([
      { period: "2026-04", planningCategory: "Paychecks", kind: "income", amountCents: 900000 },
      { period: "2026-04", planningCategory: "Interest", kind: "investment_income", amountCents: 100000 },
      { period: "2026-04", planningCategory: "Investing", kind: "saving", amountCents: 250000 },
    ]);
    expect(savingsRate(t)).toBeCloseTo(0.25);
  });

  test("no income means no rate, not a zero", () => {
    expect(savingsRate(flow([{ period: "2026-04", planningCategory: "Rent", kind: "expense", amountCents: 1000 }]))).toBeNull();
  });

  // A drawdown once "left MORE over": money taken out of a brokerage account read as
  // that month's money left over.
  test("a drawdown month reads negative saving, and leaves the same over", () => {
    const t = flow([
      { period: "2026-04", planningCategory: "Paychecks", kind: "income", amountCents: 500000 },
      { period: "2026-04", planningCategory: "Investing", kind: "saving", amountCents: -300000 },
    ]);
    expect(t.savingCents).toBe(-300000);
    expect(t.netCents).toBe(500000);
  });
});

// Four cases that were once found wrong, each pinned here.
describe("earlier findings", () => {
  // Budget, Charts, Wish List, Acquisition and Scenario compare rolled
  // up rows with only the adjustments applied, so the saving step never ran and
  // brokerage sweep noise still read as spending there.
  test("the rollup preparation the budget screens use runs the saving step", () => {
    const rows = prepareForRollup(
      [
        txn({ sourceTransactionId: "div", accountId: "brokerage", date: "2026-08-31", amountCents: 5000, sourceCategory: "Dividends" }),
        txn({ sourceTransactionId: "reinvest", accountId: "brokerage", date: "2026-08-31", amountCents: -5000, sourceCategory: null }),
      ],
      [],
      ACCOUNTS,
      {}
    );
    const rolled = rollupMonthly(rows, ACCOUNTS, {});
    expect(rolled.filter((r) => r.kind === "expense")).toEqual([]);
    expect(rolled.filter((r) => r.kind === "investment_income")).toEqual([]);
  });

  test("no screen rolls up with the adjustments alone", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(__dirname, "../../src/ui");
    const offenders = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .filter((f) => readFileSync(join(dir, f), "utf8").includes("rollupMonthly(applyAdjustments("));
    expect(offenders).toEqual([]);
  });

  // A return recognized only through the category mapping ("Bank
  // return" mapped to Interest) was not seen as a return, so the wash erased it.
  test("interest named through the mapping survives a same-day reinvestment", () => {
    const out = classifySavings(
      [
        txn({ sourceTransactionId: "int", accountId: "moneymarket", date: "2026-08-31", amountCents: 5000, sourceCategory: "Bank return" }),
        txn({ sourceTransactionId: "back", accountId: "moneymarket", date: "2026-08-31", amountCents: -5000, sourceCategory: null }),
      ],
      ACCOUNTS,
      { "Bank return": "Interest" }
    );
    expect(out.find((t) => t.sourceTransactionId === "int")!.isWash).toBeFalsy();
    expect(out.find((t) => t.sourceTransactionId === "back")!.isWash).toBe(true);
  });

  // An explicit "transfer" correction must beat a saving
  // category; the category check ran first, so the row stayed $1,000 saved.
  test("an explicit transfer correction silences a row labelled Investing", () => {
    const [row] = applyAdjustments(
      [txn({ sourceTransactionId: "buy", accountId: "checking", date: "2026-08-31", amountCents: -100000, sourceCategory: "Investing" })],
      [{ matchKind: "id", sourceTransactionId: "buy", action: "transfer" }]
    );
    expect(classify(row, {}).kind).toBe("transfer");
  });

  test("a pair-matched leg labelled Investing is still saving (the matcher's flag is not a correction)", () => {
    const row = txn({ accountId: "checking", amountCents: -100000, sourceCategory: "Investing", isTransfer: true });
    expect(classify(row, {}).kind).toBe("saving");
  });
});
