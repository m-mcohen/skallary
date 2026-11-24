// @vitest-environment jsdom
// tests/ui/chart-month-labels.test.tsx
//
// A chart's month must read the same in its tooltip as on its axis: "Sep 2026", never
// "2026-09". The one label formatter each screen gives its charts feeds both.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { mockChartBase } from "./charts/mock-chart-base";

vi.mock("../../src/ui/charts/ChartBase", async () => (await import("./charts/mock-chart-base")).default);
const charts = mockChartBase();

import ReportsSection from "../../src/ui/ReportsSection";
import NetWorthSection from "../../src/ui/NetWorthSection";
import type { Account, NormalizedTxn } from "../../src/domain/types";
import type { Period } from "../../src/domain/period";

const ALL_TIME: Period = { preset: "all", from: null, to: null };

afterEach(() => {
  cleanup();
  charts.reset();
});

const accounts = [
  { id: "a1", name: "JOINT", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
] as Account[];

const txns = [
  { sourceTransactionId: "r1", accountId: "a1", date: "2026-08-05", amountCents: -30000, sourceCategory: "Groceries", merchant: null, isTransfer: false, sourceUpdatedAt: null },
  { sourceTransactionId: "r2", accountId: "a1", date: "2026-09-15", amountCents: 800000, sourceCategory: "Paychecks", merchant: null, isTransfer: false, sourceUpdatedAt: null },
] as NormalizedTxn[];

describe("chart tooltips read months the way the axis does", () => {
  test("every Reports chart", async () => {
    render(
      <ReportsSection
        period={ALL_TIME}
        compare="none"
        dataLayer={{
          loadDb: async () => ({ base: "" }),
          getTransactions: async () => txns,
          getAccounts: async () => accounts,
          getRules: async () => [],
          getAdjustments: async () => [],
          getCategoryMappings: async () => ({}),
        }}
      />
    );
    await screen.findByTestId("report-total-Groceries");
    // Only the open tab draws its chart, so visit each tab that has one.
    for (const name of [/Cash flow/, /Left over/]) await userEvent.setup().click(screen.getByRole("tab", { name }));
    await waitFor(() => charts.last("Left over by month"));
    // One label feeds the axis and the tooltip, so a month reads the same in both.
    for (const title of ["Cash flow by month", "Left over by month"]) expect(charts.last(title).formatX!("2026-09")).toBe("Sep 2026");
  });

  // The Net worth line has a point per reading day, so its tooltip
  // reads the day the way its axis does ("Sep 30"), from the point it is shown.
  test("the Net worth chart reads its day", async () => {
    render(
      <NetWorthSection
        period={ALL_TIME}
        dataLayer={{
          loadDb: async () => ({ base: "" }),
          getAccounts: async () => accounts,
          getAccountBalances: async () => [{ accountId: "a1", balanceCents: 100_000, asOf: "2026-09-30T00:00:00Z" }],
          getBalanceReadings: async () => [{ accountId: "a1", recordedOn: "2026-09-30", balanceCents: 100_000, asOf: "2026-09-30T00:00:00Z" }],
          getIncludePartner: async () => false,
        }}
      />
    );
    await screen.findByTestId("networth-headline");
    expect(charts.last("Net worth over time").formatX!("2026-09-30")).toMatch(/^Sep 30(, 2026)?$/);
  });
});
