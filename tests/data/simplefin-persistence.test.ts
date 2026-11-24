import { expect, test, describe } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";
import type { Account, NormalizedTxn } from "../../src/domain/types";

const account: Account = {
  id: "simplefin:C:A", name: "Everyday Banking", type: null, institution: "Pinecrest Example Bank",
  currency: "USD", isOwned: true, includeInSpend: true, owner: "me",
};

describe("account type is user-owned", () => {
  test("a sync that reports no type never erases the type the user set", () => {
    // This is the SimpleFIN gap that can be silently wrong: the feed has no
    // type/subtype field at all, so every sync hands us type:null. If the
    // upsert wrote that through, the user's one-time typing -- which drives
    // drawable, retirement exclusion and liability sign -- would be erased on
    // the next daily sync.
    const repo = new NodeRepository(":memory:");
    repo.upsertAccounts([account]);
    repo.setAccountType("simplefin:C:A", "credit");
    expect(repo.getAccounts()[0].type).toBe("credit");
    expect(repo.getAccounts()[0].typeSource).toBe("user");

    repo.upsertAccounts([{ ...account, name: "Everyday Banking (renamed)", type: null }]);
    const after = repo.getAccounts()[0];
    expect(after.name).toBe("Everyday Banking (renamed)");
    expect(after.type).toBe("credit");
    expect(after.typeSource).toBe("user");
  });

  test("a feed that does report a type fills an untyped account but never overrides the user", () => {
    const repo = new NodeRepository(":memory:");
    repo.upsertAccounts([account]);
    // A future connector (or the name-based guess) supplying a type fills the blank.
    repo.upsertAccounts([{ ...account, type: "depository" }]);
    expect(repo.getAccounts()[0].type).toBe("depository");
    expect(repo.getAccounts()[0].typeSource).toBe("feed");

    // Once the user has spoken, the feed loses.
    repo.setAccountType("simplefin:C:A", "brokerage");
    repo.upsertAccounts([{ ...account, type: "depository" }]);
    expect(repo.getAccounts()[0].type).toBe("brokerage");
    expect(repo.getAccounts()[0].typeSource).toBe("user");
  });
});

describe("balance snapshot", () => {
  test("stores the reported balance, available balance and balance date", () => {
    const repo = new NodeRepository(":memory:");
    repo.upsertAccounts([account]);
    repo.setAccountBalance("simplefin:C:A", { balanceCents: 11524551, availableBalanceCents: 11500000, balanceDate: "2026-09-03" });
    const after = repo.getAccounts()[0];
    expect(after.balanceCents).toBe(11524551);
    expect(after.availableBalanceCents).toBe(11500000);
    // Surfaced in the Sync UI so "last refreshed" is honest about the Bridge's
    // once-a-day cadence rather than implying the click fetched anything.
    expect(after.balanceDate).toBe("2026-09-03");
  });
});

describe("transactions carry the SimpleFIN fields", () => {
  const txn: NormalizedTxn = {
    sourceTransactionId: "simplefin:A:t1", accountId: "simplefin:C:A", date: "2026-09-02",
    amountCents: -1000, sourceCategory: null, merchant: "John's Fishin Shack", isTransfer: false,
    sourceUpdatedAt: null, description: "Fishing bait", memo: "JOHNS FISHIN SHACK BAIT",
    payee: "John's Fishin Shack", mcc: "5812", pending: false,
  };

  test("round-trips description, memo, payee, mcc and pending", () => {
    const repo = new NodeRepository(":memory:");
    repo.upsertAccounts([account]);
    repo.upsertTransactions([txn], "simplefin");
    const [row] = repo.getTransactions();
    expect(row.memo).toBe("JOHNS FISHIN SHACK BAIT");
    expect(row.payee).toBe("John's Fishin Shack");
    expect(row.mcc).toBe("5812");
    expect(row.description).toBe("Fishing bait");
    expect(row.pending).toBe(false);
  });

  test("records which feed each row came from so older imported history and SimpleFIN can coexist", () => {
    const repo = new NodeRepository(":memory:");
    repo.upsertAccounts([account]);
    repo.upsertTransactions([txn], "simplefin");
    expect(repo.getTransactionSource("simplefin:A:t1")).toBe("simplefin");
  });

  test("re-syncing the same transaction updates rather than duplicating", () => {
    // The incremental fetch deliberately overlaps 5 days, so it re-sends rows
    // it has already sent. That has to be free.
    const repo = new NodeRepository(":memory:");
    repo.upsertAccounts([account]);
    const first = repo.upsertTransactions([txn], "simplefin");
    expect(first).toEqual({ inserted: 1, updated: 0 });

    const second = repo.upsertTransactions([txn], "simplefin");
    expect(second).toEqual({ inserted: 0, updated: 1 });
    expect(repo.getTransactions()).toHaveLength(1);
  });

  test("a pending row that later settles updates in place, keeping one transaction", () => {
    const repo = new NodeRepository(":memory:");
    repo.upsertAccounts([account]);
    repo.upsertTransactions([{ ...txn, pending: true, date: "2026-09-01" }], "simplefin");
    repo.upsertTransactions([{ ...txn, pending: false, date: "2026-09-02" }], "simplefin");
    const rows = repo.getTransactions();
    expect(rows).toHaveLength(1);
    expect(rows[0].pending).toBe(false);
    expect(rows[0].date).toBe("2026-09-02");
  });

  test("getPendingTransactions returns only live pending rows from the named feed", () => {
    // The pending->posted safeguard compares the DB's outstanding pending rows
    // against each window's posted rows, so it needs exactly this slice:
    // pending, not retired, and from the feed being synced.
    const repo = new NodeRepository(":memory:");
    repo.upsertAccounts([account]);
    repo.upsertTransactions([
      { ...txn, sourceTransactionId: "simplefin:A:pending", pending: true },
      { ...txn, sourceTransactionId: "simplefin:A:posted", pending: false },
      { ...txn, sourceTransactionId: "simplefin:A:retired", pending: true },
    ], "simplefin");
    repo.upsertTransactions([{ ...txn, sourceTransactionId: "monarch:x", pending: true }], "monarch");
    repo.retireTransactions(["simplefin:A:retired"]);

    const pending = repo.getPendingTransactions("simplefin");
    expect(pending.map((t) => t.sourceTransactionId)).toEqual(["simplefin:A:pending"]);
    expect(pending[0].pending).toBe(true);
    expect(repo.getPendingTransactions("monarch").map((t) => t.sourceTransactionId)).toEqual(["monarch:x"]);
  });
});

describe("holdings", () => {
  const holding = {
    accountId: "simplefin:C:A", symbol: "AAPL", description: "Shares of Apple", shares: "550.0",
    costBasisCents: 5500, marketValueCents: 10500000, purchasePriceCents: 10, currency: "USD",
  };

  test("replaces the whole snapshot rather than appending -- positions are a snapshot, not a log", () => {
    const repo = new NodeRepository(":memory:");
    repo.upsertAccounts([account]);
    repo.replaceHoldings("simplefin:C:A", [holding]);
    repo.replaceHoldings("simplefin:C:A", [{ ...holding, marketValueCents: 11000000 }]);
    const rows = repo.getHoldings();
    expect(rows).toHaveLength(1);
    expect(rows[0].marketValueCents).toBe(11000000);
  });

  test("clearing an account's positions doesn't touch another account's", () => {
    const repo = new NodeRepository(":memory:");
    repo.upsertAccounts([account, { ...account, id: "simplefin:C:B", name: "Other" }]);
    repo.replaceHoldings("simplefin:C:A", [holding]);
    repo.replaceHoldings("simplefin:C:B", [{ ...holding, accountId: "simplefin:C:B", symbol: "VTI" }]);
    repo.replaceHoldings("simplefin:C:A", []);
    const rows = repo.getHoldings();
    expect(rows.map((r) => r.symbol)).toEqual(["VTI"]);
  });
});

describe("connector state", () => {
  test("round-trips the access url, sync cursor and last errors", () => {
    const repo = new NodeRepository(":memory:");
    expect(repo.getSimpleFinState()).toBeNull();

    repo.setSimpleFinState({
      accessUrl: "https://u:p@bridge.example/simplefin",
      lastSyncedAt: "2026-09-02T12:00:00.000Z",
      earliestBackfilled: "2024-09-02",
      lastErrors: [{ code: "act.failed", message: "boom", accountId: "A", connectionId: null }],
    });
    const state = repo.getSimpleFinState()!;
    expect(state.accessUrl).toBe("https://u:p@bridge.example/simplefin");
    expect(state.lastSyncedAt).toBe("2026-09-02T12:00:00.000Z");
    expect(state.earliestBackfilled).toBe("2024-09-02");
    expect(state.lastErrors[0].code).toBe("act.failed");
  });
});
