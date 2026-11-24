// @vitest-environment jsdom
// Net worth over time is a long time line, so the chart offers zoom. ReportsSection's bars are categories and do not.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import NetWorthSection from "../../src/ui/NetWorthSection";
import { mockChartBase } from "./charts/mock-chart-base";

vi.mock("../../src/ui/charts/ChartBase", async () => (await import("./charts/mock-chart-base")).default);
const charts = mockChartBase();
beforeEach(() => charts.reset());
afterEach(cleanup);

test("the net worth line has zoom on", async () => {
  const layer = {
    loadDb: async () => ({ base: "" }),
    getAccounts: async () => [{ id: "a1", name: "JOINT", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" }],
    getAccountBalances: async () => [{ accountId: "a1", balanceCents: 100_000, asOf: "2026-09-30T00:00:00Z" }],
    getBalanceReadings: async () => [{ accountId: "a1", recordedOn: "2026-09-30", balanceCents: 100_000, asOf: "2026-09-30T12:00:00Z" }],
    getIncludePartner: async () => false,
  };
  render(<NetWorthSection period={{ preset: "all", from: null, to: null }} dataLayer={layer} />);
  await screen.findByTestId("networth-chart-summary");
  expect(charts.last("Net worth over time").zoom).toBe(true);
});
