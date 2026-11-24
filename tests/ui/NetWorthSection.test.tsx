// @vitest-environment jsdom
// tests/ui/NetWorthSection.test.tsx
//
// One net worth line from the balance readings each sync
// stores, ending on the headline, with a legend. The transaction back-cast and
// the Drawable line are gone.
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import NetWorthSection from "../../src/ui/NetWorthSection";
import { customPeriod, type Period } from "../../src/domain/period";
import type { BalanceReading } from "../../src/domain/plan-types";

// Every render pins the period, so no test depends on today's date.
const ALL_TIME: Period = { preset: "all", from: null, to: null };

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = ResizeObserverStub;
});

afterEach(cleanup);

const acct = (id: string, name: string, type: string, extra: Record<string, unknown> = {}) => ({
  id, name, type, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me", ...extra,
});
const reading = (accountId: string, recordedOn: string, balanceCents: number): BalanceReading => ({
  accountId, recordedOn, balanceCents, asOf: `${recordedOn}T12:00:00Z`,
});

const layer = (over: Record<string, unknown> = {}) => ({
  loadDb: async () => ({ base: "" }),
  getAccounts: async () => [acct("a1", "JOINT", "depository")],
  getAccountBalances: async () => [{ accountId: "a1", balanceCents: 100_000, asOf: "2026-09-30T00:00:00Z" }],
  getBalanceReadings: async () => [reading("a1", "2026-08-20", 80_000), reading("a1", "2026-09-30", 100_000)],
  getIncludePartner: async () => false,
  ...over,
});

describe("NetWorthSection", () => {
  test("shows the current net worth as the headline", async () => {
    render(<NetWorthSection period={ALL_TIME} dataLayer={layer()} />);
    await waitFor(() => {
      expect(screen.getByTestId("networth-headline").textContent).toMatch(/1,000\.00/);
    });
  });

  // A point for each day with a reading, not each month.
  test("one net worth line, a point per reading day, ending on the headline", async () => {
    render(<NetWorthSection period={ALL_TIME} dataLayer={layer()} />);
    const summary = await screen.findByTestId("networth-chart-summary");
    expect(summary.textContent).toMatch(/^Net worth, each day the banks were read: Aug 20(?:, 2026)? \$800\.00; Sep 30(?:, 2026)? \$1,000\.00\.$/);
    expect(screen.getByTestId("networth-headline").textContent).toBe("$1,000.00");
  });

  test("beside the headline, the change since the first point drawn", async () => {
    render(<NetWorthSection period={ALL_TIME} dataLayer={layer()} />);
    const change = await screen.findByTestId("networth-change");
    // 1,000.00 - 800.00, up.
    expect(change.textContent).toMatch(/\$200\.00\s*since Aug 20/);
    expect(change.querySelector(".text-positive")).not.toBeNull();
  });

  test("the screen says why earlier days are left off", async () => {
    render(<NetWorthSection period={ALL_TIME} dataLayer={layer()} />);
    const note = await screen.findByTestId("networth-history-note");
    expect(note.textContent).toMatch(/since Aug 20/);
    expect(note.textContent).toMatch(/left off/i);
    // The old lines are gone, and so are their words.
    expect(screen.queryByText(/drawable/i)).toBeNull();
    expect(screen.queryByText(/derived from transactions/i)).toBeNull();
  });

  test("no readings yet: says so, and still shows today's balance", async () => {
    render(<NetWorthSection period={ALL_TIME} dataLayer={layer({ getBalanceReadings: async () => [] })} />);
    expect(await screen.findByText(/No readings yet/i)).toBeTruthy();
    expect(screen.getByTestId("networth-headline").textContent).toBe("$1,000.00");
  });
});

// The headline added every balance row raw, so an archived record
// counted the same money as its live record, and debt trusted the feed's sign.
describe("NetWorthSection totals", () => {
  test("an archived record is left out of the headline and the line, and a card subtracts even when reported positive", async () => {
    render(
      <NetWorthSection period={ALL_TIME}
        dataLayer={layer({
          getAccounts: async () => [
            acct("a1", "JOINT", "depository"),
            acct("a1-old", "JOINT (old record)", "depository", { archived: true }),
            acct("c1", "VISA", "credit"),
          ],
          getAccountBalances: async () => [
            { accountId: "a1", balanceCents: 100_000, asOf: "2026-08-31T00:00:00Z" },
            { accountId: "a1-old", balanceCents: 95_000, asOf: "2026-06-30T00:00:00Z" },
            { accountId: "c1", balanceCents: 25_000, asOf: "2026-08-31T00:00:00Z" },
          ],
          getBalanceReadings: async () => [
            reading("a1-old", "2026-08-31", 95_000),
            reading("a1", "2026-08-31", 100_000),
            reading("c1", "2026-08-31", 25_000),
          ],
        })}
      />
    );
    // 1,000.00 - 250.00 = 750.00; the archived 950.00 is not added.
    await waitFor(() => expect(screen.getByTestId("networth-headline").textContent).toBe("$750.00"));
    expect(screen.getByTestId("networth-chart-summary").textContent).toMatch(/Aug 31(?:, 2026)? \$750\.00\.$/);
  });

  test("the partner's own account follows the Include switch, in the headline and the line", async () => {
    const withPartner = (includePartner: boolean) =>
      layer({
        getAccounts: async () => [acct("a1", "JOINT", "depository"), acct("p1", "PARTNER SAVINGS", "depository", { owner: "partner" })],
        getAccountBalances: async () => [
          { accountId: "a1", balanceCents: 100_000, asOf: "2026-09-30T00:00:00Z" },
          { accountId: "p1", balanceCents: 400_000, asOf: "2026-09-30T00:00:00Z" },
        ],
        getBalanceReadings: async () => [reading("a1", "2026-09-30", 100_000), reading("p1", "2026-09-30", 400_000)],
        getIncludePartner: async () => includePartner,
      });

    render(<NetWorthSection period={ALL_TIME} dataLayer={withPartner(false)} />);
    await waitFor(() => expect(screen.getByTestId("networth-headline").textContent).toBe("$1,000.00"));
    expect(screen.getByTestId("networth-chart-summary").textContent).toMatch(/Sep 30(?:, 2026)? \$1,000\.00\.$/);

    cleanup();
    render(<NetWorthSection period={ALL_TIME} dataLayer={withPartner(true)} />);
    // 1,000.00 + 4,000.00 = 5,000.00
    await waitFor(() => expect(screen.getByTestId("networth-headline").textContent).toBe("$5,000.00"));
    expect(screen.getByTestId("networth-chart-summary").textContent).toMatch(/Sep 30(?:, 2026)? \$5,000\.00\.$/);
  });
});

describe("NetWorthSection follows the period", () => {
  test("says which days are drawn, and that the headline is still today's balance", async () => {
    render(<NetWorthSection period={ALL_TIME} dataLayer={layer()} />);
    const note = await screen.findByTestId("networth-period-note");
    expect(note.textContent).toMatch(/All time/);
    expect(note.textContent).toMatch(/today/i);
    expect(Number(note.getAttribute("data-days"))).toBe(2);

    cleanup();
    render(<NetWorthSection period={customPeriod("2026-08-01", "2026-08-31")} dataLayer={layer()} />);
    const august = await screen.findByTestId("networth-period-note");
    expect(august.textContent).toMatch(/Aug 1 to Aug 31, 2026/);
    expect(Number(august.getAttribute("data-days"))).toBe(1);
    // The headline is a balance today, not a figure for the period.
    expect(screen.getByTestId("networth-headline").textContent).toMatch(/1,000\.00/);
  });

  test("a period with no history in it says so, rather than drawing an empty chart", async () => {
    render(<NetWorthSection period={customPeriod("2031-01-01", "2031-12-31")} dataLayer={layer()} />);
    expect(await screen.findByText(/No readings inside this period/i)).toBeTruthy();
  });
});
