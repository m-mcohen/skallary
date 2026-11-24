import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mapSimpleFinResponse, type SimpleFinResponse } from "../../src/domain/simplefin";

// The real thing: captured live from the SimpleFIN Bridge's public demo token
// (version=2) on 2026-09-02. If the Bridge changes shape, this fixture is how
// we find out -- do not hand-edit it to make a test pass.
const DEMO: SimpleFinResponse = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/simplefin-demo-v2.json", import.meta.url)), "utf8")
);

describe("mapSimpleFinResponse -- accounts", () => {
  it("namespaces account ids by connection so two banks can't collide", () => {
    const { accounts } = mapSimpleFinResponse(DEMO);
    // SimpleFIN only promises account ids are unique WITHIN a connection.
    expect(accounts.map((a) => a.id)).toEqual([
      "simplefin:CON-SIMPLEFIN-DEMO:Demo Savings",
      "simplefin:CON-SIMPLEFIN-DEMO:Demo Checking",
      "simplefin:CON-SIMPLEFIN-DEMO:Demo Empty Account",
    ]);
  });

  it("carries name, currency and institution, and leaves type unset", () => {
    const { accounts } = mapSimpleFinResponse(DEMO);
    const savings = accounts[0];
    expect(savings.name).toBe("SimpleFIN Savings");
    expect(savings.currency).toBe("USD");
    expect(savings.institution).toBe("SimpleFIN Bridge");
    // SimpleFIN has no account type/subtype field at all -- the user types
    // accounts once in the app and sync must never overwrite that.
    expect(savings.type).toBeNull();
  });

  it("parses balances to cents and keeps the balance date the feed reports", () => {
    const { accounts } = mapSimpleFinResponse(DEMO);
    expect(accounts[0].balanceCents).toBe(11524551);
    expect(accounts[0].availableBalanceCents).toBe(11524551);
    expect(accounts[0].balanceDate).toBe("2026-09-03");
  });
});

describe("mapSimpleFinResponse -- transactions", () => {
  it("preserves the feed's sign convention: negative is money out", () => {
    const { transactions } = mapSimpleFinResponse(DEMO);
    const bait = transactions.find((t) => t.sourceTransactionId.endsWith("1788336000") && t.accountId.includes("Savings"))!;
    // "-10.00" in, -1000 cents out. SimpleFIN already matches our schema;
    // this is the assertion that catches anyone "fixing" it into a flip.
    expect(bait.amountCents).toBe(-1000);
  });

  it("dates transactions from `posted` in UTC so the same DB reads the same on any machine", () => {
    const { transactions } = mapSimpleFinResponse(DEMO);
    // posted 1788364800 = 2026-09-02T16:00:00Z. Local-time extraction would
    // make this machine-dependent; a late-evening UTC stamp would roll a day.
    const groceries = transactions.find((t) => t.sourceTransactionId.endsWith("1788364800"))!;
    expect(groceries.date).toBe("2026-09-02");
  });

  it("keeps payee, the raw bank memo, and the merchant category code", () => {
    const { transactions } = mapSimpleFinResponse(DEMO);
    const bait = transactions[0];
    expect(bait.payee).toBe("John's Fishin Shack");
    // The raw memo is the whole point of leaving Monarch -- it's the substrate
    // the categorization rules match on.
    expect(bait.memo).toBe("JOHNS FISHIN SHACK BAIT");
    expect(bait.mcc).toBe("5812");
    expect(bait.description).toBe("Fishing bait");
  });

  it("uses payee as the merchant, falling back to description when absent", () => {
    const { transactions } = mapSimpleFinResponse(DEMO);
    expect(transactions[0].merchant).toBe("John's Fishin Shack");

    const noPayee = mapSimpleFinResponse(withTxn({ id: "t1", posted: 1788336000, amount: "-5.00", description: "ACH DEBIT" }));
    expect(noPayee.transactions[0].merchant).toBe("ACH DEBIT");
  });

  it("namespaces transaction ids by account -- ids are only unique within one", () => {
    const { transactions } = mapSimpleFinResponse(DEMO);
    // Savings and Checking both carry a transaction with id "1788336000".
    const ids = transactions.map((t) => t.sourceTransactionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("simplefin:Demo Savings:1788336000");
    expect(ids).toContain("simplefin:Demo Checking:1788336000");
  });

  it("dates a pending transaction from transacted_at, since posted is 0 until it settles", () => {
    const res = mapSimpleFinResponse(
      withTxn({ id: "p1", posted: 0, transacted_at: 1788336000, amount: "-20.00", description: "PENDING HOLD", pending: true })
    );
    expect(res.transactions[0].date).toBe("2026-09-02");
    expect(res.transactions[0].pending).toBe(true);
  });

  it("marks settled transactions not pending even when the flag is absent", () => {
    const { transactions } = mapSimpleFinResponse(DEMO);
    expect(transactions.every((t) => t.pending === false)).toBe(true);
  });

  it("drops a transaction with no usable date rather than inventing one", () => {
    const res = mapSimpleFinResponse(withTxn({ id: "bad", posted: 0, amount: "-1.00", description: "NO DATE" }));
    expect(res.transactions).toHaveLength(0);
    expect(res.skipped).toEqual([{ accountId: "simplefin:C:A", transactionId: "bad", reason: "no usable date" }]);
  });

  it("returns no transactions for an account that has none", () => {
    const { transactions } = mapSimpleFinResponse(DEMO);
    expect(transactions.filter((t) => t.accountId.includes("Empty Account"))).toHaveLength(0);
  });

  it("assigns no source category -- SimpleFIN provides none, the rules engine owns it", () => {
    const { transactions } = mapSimpleFinResponse(DEMO);
    expect(transactions.every((t) => t.sourceCategory === null)).toBe(true);
    // And nothing is pre-flagged as a transfer; pair-matching decides that later.
    expect(transactions.every((t) => t.isTransfer === false)).toBe(true);
  });
});

describe("mapSimpleFinResponse -- holdings and errors", () => {
  it("maps investment positions with cents-valued money fields", () => {
    const { holdings } = mapSimpleFinResponse(DEMO);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toEqual({
      accountId: "simplefin:CON-SIMPLEFIN-DEMO:Demo Savings",
      symbol: "AAPL",
      description: "Shares of Apple",
      shares: "550.0",
      costBasisCents: 5500,
      marketValueCents: 10588480, // "105884.8" -- one decimal place
      purchasePriceCents: 10,
      currency: "USD",
    });
  });

  it("surfaces the feed's structured errors instead of throwing them away", () => {
    const res = mapSimpleFinResponse({
      ...DEMO,
      errlist: [{ code: "act.failed", msg: "Could not reach institution", account_id: "Demo Checking" }],
    });
    expect(res.errors).toEqual([
      { code: "act.failed", message: "Could not reach institution", accountId: "Demo Checking", connectionId: null, connectionName: null },
    ]);
    // A per-account failure must not discard the accounts that did come back.
    expect(res.accounts).toHaveLength(3);
  });

  it("tolerates a v1-shaped payload with no connections array", () => {
    const { accounts } = mapSimpleFinResponse({ accounts: [{ ...DEMO.accounts[0], conn_id: undefined }] } as SimpleFinResponse);
    expect(accounts[0].id).toBe("simplefin:unknown:Demo Savings");
    expect(accounts[0].institution).toBeNull();
  });
});

/** A minimal one-account, one-transaction response for the edge cases the demo doesn't cover. */
function withTxn(txn: Record<string, unknown>): SimpleFinResponse {
  return {
    errlist: [],
    accounts: [
      {
        id: "A",
        name: "Test",
        currency: "USD",
        balance: "0.00",
        "balance-date": 1788393600,
        conn_id: "C",
        transactions: [txn as never],
        holdings: [],
      },
    ],
    connections: [{ conn_id: "C", name: "Test Bank", org_id: "test", sfin_url: "https://x" }],
  };
}
