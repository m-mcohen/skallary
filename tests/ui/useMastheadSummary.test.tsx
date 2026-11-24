// @vitest-environment jsdom
// tests/ui/useMastheadSummary.test.tsx
//
// The head's data flow, split in two: the reads are keyed on the plan and the
// refresh tick only, and the scenario is composed over them in memory. The
// property worth pinning is that a scenario change -- which the scrubber
// makes on every slider step -- never re-issues a fetch.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

import { useMastheadInputs, useMastheadSummary } from "../../src/ui/lib/useMastheadSummary";
import type { Db } from "../../src/ui/lib/db";
import type { NormalizedTxn } from "../../src/domain/types";
import type { Scenario } from "../../src/domain/scenario";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";

afterEach(cleanup);

const accounts = [
  { id: "chk", name: "Checking", type: "depository", institution: "B", currency: "USD", isOwned: true, includeInSpend: true, owner: "me" as const, balanceCents: 7500000 },
];
const budgetLines = [
  { planId: "p1", planningCategory: "Rent", period: null, amountCents: 700000 },
  { planId: "p1", planningCategory: "Charity", period: null, amountCents: 60_000 },
  { planId: "p1", planningCategory: "Charity", period: "2026-10", amountCents: 70_000 },
];
const goal: Scenario = {
  id: "s1", planId: "p1", name: "Goal from March", isDefault: false, createdAt: "",
  income: { kind: "custom", netMonthlyCents: 1_040_000, startPeriod: "2027-03" },
  expenseDeltas: [],
};

function stub() {
  const fetchers = {
    loadDb: async () => ({ base: "/api" }) as Db,
    getAccounts: vi.fn(async () => accounts as never),
    getAccountBalances: vi.fn(async () => [{ accountId: "chk", balanceCents: 7500000, asOf: "2026-09-02" }]),
    getCategorySettings: vi.fn(async () => []),
    getUncategorized: vi.fn(async () => []),
    getRules: vi.fn(async () => []),
    getConnectorStatus: vi.fn(async () => ({ lastSyncedAt: "2026-09-02T12:00:00.000Z" }) as never),
    getSeedStatus: vi.fn(async () => ({ lastSeedAt: "2026-09-02T18:07:00.000Z", windowMonths: 12, reseedDueAt: "2026-12-01", reseedDue: false })),
    getTrailing: vi.fn(async () => ({ months: 12, window: [], totalCents: 0, monthlyAverageCents: 700_000 })),
    getBudgetLines: vi.fn(async () => budgetLines),
    getBudgetExtras: async () => ({ changes: [], bigMonths: [], notes: [] }),
    getSalarySettings: vi.fn(async () => ({ premiumMonthlyCents: 63_000, maaserRate: 0.1, children: 1 })),
    listWishlistItems: vi.fn(async () => [
      { id: "w1", name: "Couch", costCents: 500_000, kind: "planned" as const, targetDate: "2026-11-01", priority: 1, planningCategory: null },
      { id: "w2", name: "Someday", costCents: 100_000, kind: "wish" as const, targetDate: null, priority: 2, planningCategory: null },
    ]),
  };
  return fetchers;
}

describe("useMastheadInputs + useMastheadSummary", () => {
  test("fetches once per plan and tick, and recomposes a scenario change in memory", async () => {
    const fetchers = stub();
    const { result, rerender } = renderHook(
      ({ scenario, tick }: { scenario: Scenario | null; tick: number }) => {
        const inputs = useMastheadInputs("p1", tick, fetchers);
        return { inputs, summary: useMastheadSummary(inputs, scenario) };
      },
      { initialProps: { scenario: null, tick: 0 } }
    );
    await waitFor(() => expect(result.current.summary).not.toBeNull());
    expect(fetchers.getAccounts).toHaveBeenCalledTimes(1);
    expect(fetchers.getTrailing).toHaveBeenCalledTimes(1);
    const plain = result.current.summary!;
    expect(plain.scenarioLabel).toBeNull();
    expect(plain.trailingCents).toBe(700_000);

    rerender({ scenario: goal, tick: 0 });
    expect(result.current.summary!.scenarioLabel).toBe("Goal from March");
    expect(result.current.summary!.baselineSeries).toEqual(plain.reading.series);
    expect(fetchers.getAccounts).toHaveBeenCalledTimes(1);
    expect(fetchers.getTrailing).toHaveBeenCalledTimes(1);
    expect(fetchers.getBudgetLines).toHaveBeenCalledTimes(1);

    rerender({ scenario: goal, tick: 1 });
    await waitFor(() => expect(fetchers.getAccounts).toHaveBeenCalledTimes(2));
  });

  test("reads trailing spend and the seed date without a plan, but no budget lines", async () => {
    const fetchers = stub();
    const { result } = renderHook(() => {
      const inputs = useMastheadInputs(null, 0, fetchers);
      return useMastheadSummary(inputs, null);
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(fetchers.getTrailing).toHaveBeenCalledTimes(1);
    expect(fetchers.getBudgetLines).not.toHaveBeenCalled();
    expect(result.current!.trailingCents).toBe(700_000);
    expect(result.current!.lastSeedAt).toBe("2026-09-02T18:07:00.000Z");
  });

  // The Dashboard names a bank that needs a sign-in, so the hook
  // has to carry the connector's saved warning all the way to the summary.
  // It carries the shared bank-problems list, which also reads each
  // account's balance date, so a quiet bank reaches the summary too.
  test("carries the banks that need attention, from the connector status and the accounts, to the summary", async () => {
    const fetchers = stub();
    fetchers.getConnectorStatus = vi.fn(async () => ({
      lastSyncedAt: "2026-09-02T12:00:00.000Z",
      lastErrors: [{ code: "con.auth", message: "Connection to Example Brokerage may need attention. Auth required" }],
    }) as never);
    // A balance date years old is quiet whatever today is.
    fetchers.getAccounts = vi.fn(async () => [
      { id: "s1", name: "Card", type: "credit", institution: "Sample Card Bank", currency: "USD", isOwned: true, includeInSpend: true, owner: "me", balanceDate: "2020-01-02" },
      { id: "s2", name: "Old card", type: "credit", institution: "Old Bank", currency: "USD", isOwned: true, includeInSpend: true, owner: "me", balanceDate: "2020-01-01", archived: true },
    ] as never);
    const { result } = renderHook(() => useMastheadSummary(useMastheadInputs("p1", 0, fetchers), null));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.bankProblems).toEqual([
      { kind: "sign-in", bank: "Example Brokerage", lastDataDate: null },
      { kind: "quiet", bank: "Sample Card Bank", lastDataDate: "2020-01-02" },
    ]);
  });

  // The Wish List is one-time items and does not feed the forecast.
  test("never reads the Wish List: nothing on it reaches the projection", async () => {
    const fetchers = stub();
    const { result } = renderHook(() => useMastheadInputs("p1", 0, fetchers));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(fetchers.listWishlistItems).not.toHaveBeenCalled();
    expect(result.current!.plannedEvents ?? []).toEqual([]);
  });

  test("degrades to nothing rather than throwing when a read fails", async () => {
    const fetchers = stub();
    fetchers.getAccounts.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useMastheadInputs("p1", 0, fetchers));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBeNull();
  });

  // Minor 4: a failed transactions read must reach the bar as "could not read", not as loading.
  test("flags the top bar's statement as unreadable when the transactions read fails, and not when it works", async () => {
    const good = { ...stub(), getTransactions: async () => [], getAdjustments: async () => [], getCategoryMappings: async () => ({}) };
    const ok = renderHook(() => useMastheadSummary(useMastheadInputs("p1", 0, good), null));
    await waitFor(() => expect(ok.result.current).not.toBeNull());
    expect(ok.result.current!.equationUnreadable).toBe(false);
    expect(ok.result.current!.equation).not.toBeUndefined();
    cleanup();

    const bad = { ...good, getTransactions: async (): Promise<never> => { throw new Error("offline"); } };
    const { result } = renderHook(() => useMastheadSummary(useMastheadInputs("p1", 0, bad), null));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.equationUnreadable).toBe(true);
    expect(result.current!.equation).toBeNull();
    // The rest of the head still reads.
    expect(result.current!.trailingCents).toBe(700_000);
  });

  test("falls back to the default salary assumptions rather than blanking the head when that route fails", async () => {
    const fetchers = stub();
    fetchers.getSalarySettings = vi.fn(async () => {
      throw new Error("route down");
    });
    const { result } = renderHook(() => useMastheadInputs("p1", 0, fetchers));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.salaryAssumptions).toEqual(DEFAULT_SALARY_ASSUMPTIONS);
  });
});

describe("Spent this month", () => {
  test("is computed from the transactions, on the same days of last month, as of today", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 8, 20, 12, 0, 0)); // Sep 20, 2026, local
    try {
      const t = (id: string, date: string, amountCents: number, sourceCategory: string) =>
        ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory, merchant: null, isTransfer: false, sourceUpdatedAt: null }) as NormalizedTxn;
      const fetchers = {
        ...stub(),
        getTransactions: vi.fn(async () => [t("s", "2026-09-05", -10000, "Groceries"), t("b", "2026-08-05", -4000, "Groceries"), t("late", "2026-08-25", -99900, "Groceries"), t("old", "2026-07-01", -1, "Groceries")]),
        getAdjustments: vi.fn(async () => []),
        getCategoryMappings: vi.fn(async () => ({})),
      };
      const { result } = renderHook(() => useMastheadInputs("p1", 0, fetchers));
      await waitFor(() => expect(result.current).not.toBeNull());
      expect(result.current!.spentThisMonth).toEqual({
        period: { preset: "this-month", from: "2026-09-01", to: "2026-09-20" },
        cents: 10000,
        // With each top category on the same days.
        baseline: { range: { from: "2026-08-01", to: "2026-08-20" }, cents: 4000, byCategory: { Groceries: 4000 } },
        // This month so far also carries left over and the top categories.
        leftOverCents: -10000,
        // Money moved into or out of savings, beside Left over rather than in it.
        savingCents: 0,
        topCategories: [{ category: "Groceries", cents: 10000 }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // The Income card reads from the same prepared rows as Spent.
  test("income this month comes from the same transactions, with its payers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 8, 20, 12, 0, 0)); // Sep 20, 2026, local
    try {
      const t = (id: string, date: string, amountCents: number, sourceCategory: string, payee: string | null = null) =>
        ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory, payee, merchant: null, isTransfer: false, sourceUpdatedAt: null }) as NormalizedTxn;
      const fetchers = {
        ...stub(),
        getTransactions: vi.fn(async () => [t("st", "2026-09-10", 500000, "Business Income", "Acme Consulting"), t("aug", "2026-08-10", 1, "Business Income")]),
        getAdjustments: vi.fn(async () => []),
        getCategoryMappings: vi.fn(async () => ({})),
      };
      const { result } = renderHook(() => useMastheadSummary(useMastheadInputs("p1", 0, fetchers), null));
      await waitFor(() => expect(result.current).not.toBeNull());
      expect(result.current!.incomeThisMonth!.cents).toBe(500000);
      expect(result.current!.incomeThisMonth!.topSources).toEqual([{ payeeKey: "acme consulting", label: "Acme Consulting", cents: 500000 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  // The chart's lines come from the same prepared rows, so this month's line ends on Spent this month.
  test("the spending curves ride along, and this month's line ends on Spent this month", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 8, 20, 12, 0, 0)); // Sep 20, 2026, local
    try {
      const t = (id: string, date: string, amountCents: number) =>
        ({ sourceTransactionId: id, accountId: "a1", date, amountCents, sourceCategory: "Groceries", merchant: null, isTransfer: false, sourceUpdatedAt: null }) as NormalizedTxn;
      const fetchers = {
        ...stub(),
        getTransactions: vi.fn(async () => [t("s", "2026-09-05", -10000), t("b", "2026-08-05", -4000), t("old", "2025-07-01", -1)]),
        getAdjustments: vi.fn(async () => []),
        getCategoryMappings: vi.fn(async () => ({})),
      };
      const { result } = renderHook(() => useMastheadSummary(useMastheadInputs("p1", 0, fetchers), null));
      await waitFor(() => expect(result.current).not.toBeNull());
      const curves = result.current!.spendingCurves!;
      expect(curves.month).toBe("2026-09");
      expect(curves.today).toBe(20);
      expect(curves.thisMonth[19]).toBe(result.current!.spentThisMonth!.cents);
      expect(curves.lastMonth![19]).toBe(4000);
      expect(curves.averageMonth).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a failed transactions read leaves the tile empty rather than blanking the Dashboard", async () => {
    const fetchers = { ...stub(), getTransactions: vi.fn(async (): Promise<NormalizedTxn[]> => { throw new Error("offline"); }) };
    const { result } = renderHook(() => useMastheadInputs("p1", 0, fetchers));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.spentThisMonth).toBeNull();
    expect(result.current!.spendingCurves).toBeNull();
    expect(result.current!.trailingCents).toBe(700_000);
  });
});

// A past month on the Dashboard counts its planned big months,
// so the month source the Dashboard keeps must carry the plan's big months.
test("a past month's source carries the plan's big months", async () => {
  const big = { id: 1, planId: "p1", planningCategory: "Gifts", month: "2026-12", label: "Holiday", amountCents: 80_000, createdAt: "" };
  const fetchers = {
    ...stub(),
    getBudgetExtras: vi.fn(async () => ({ changes: [], bigMonths: [big], notes: [] })),
    getTransactions: vi.fn(async () => [] as NormalizedTxn[]),
    getAdjustments: vi.fn(async () => []),
    getCategoryMappings: vi.fn(async () => ({})),
  };
  const { result } = renderHook(() => useMastheadInputs("p1", 0, fetchers));
  await waitFor(() => expect(result.current?.monthSource).toBeTruthy());
  expect(result.current!.monthSource!.bigMonths).toEqual([big]);
  expect(fetchers.getBudgetExtras).toHaveBeenCalledWith(expect.anything(), "p1");
});

// A failed big-months read must not blank the whole head.
test("a failed big-months read leaves the head up, with no big months", async () => {
  const fetchers = {
    ...stub(),
    getBudgetExtras: vi.fn(async (): Promise<never> => { throw new Error("route down"); }),
    getTransactions: vi.fn(async () => [] as NormalizedTxn[]),
    getAdjustments: vi.fn(async () => []),
    getCategoryMappings: vi.fn(async () => ({})),
  };
  const { result } = renderHook(() => useMastheadInputs("p1", 0, fetchers));
  await waitFor(() => expect(result.current).not.toBeNull());
  expect(result.current!.monthSource!.bigMonths).toEqual([]);
});
