// @vitest-environment jsdom
// tests/ui/BillsSection.test.tsx
//
// The Recurring screen (was Bills): the month summary,
// every recurring charge with Not recurring, the hidden list with Show again,
// and the two budget checks. The file keeps its old name (BillsSection.tsx), as
// RunwayOverview.tsx kept its name when that screen became Forecast.
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import BillsSection from "../../src/ui/BillsSection";
import { parseLedgerQuery } from "../../src/ui/lib/ledger-link";
import type { NormalizedTxn } from "../../src/domain/types";
import type { RecurringChoice, RecurringChoiceInput } from "../../src/domain/recurring-choices";

afterEach(cleanup);

const run = (payee: string, accountId: string, dates: string[], cents: number, sourceCategory = "Business Software"): NormalizedTxn[] =>
  dates.map((date, i) => ({
    sourceTransactionId: `${payee}-${accountId}-${i}`,
    accountId,
    date,
    amountCents: -cents,
    sourceCategory,
    merchant: null,
    isTransfer: false,
    sourceUpdatedAt: null,
    payee,
  })) as NormalizedTxn[];

const netflix = () => run("Netflix", "a1", ["2026-03-15", "2026-04-15", "2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15"], 1500);
const gym = () => run("City Gym", "a1", ["2026-06-02", "2026-07-02", "2026-08-02", "2026-09-02"], 4500, "Fitness");

const accounts = [
  { id: "a1", name: "PERSONAL CHECKING (0404)", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
  { id: "a2", name: "Rewards Card (0303))", type: "credit", institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" },
];

/** A data layer whose choices really change when saved or deleted, like the server. */
const layer = (over: Record<string, unknown> = {}) => {
  let choices: RecurringChoice[] = [];
  const saved: RecurringChoiceInput[] = [];
  return {
    saved,
    loadDb: async () => ({ base: "" }),
    getAccounts: async () => accounts,
    getTransactions: async () => [...netflix(), ...gym()],
    getRules: async () => [],
    getAdjustments: async () => [],
    getCategoryMappings: async () => ({}),
    getCategorySettings: async () => [{ planningCategory: "Business Software", recurring: true, recurringSource: "user", pinned: false }],
    getRecurringChoices: async () => choices,
    saveRecurringChoice: async (_db: unknown, c: RecurringChoiceInput) => {
      saved.push(c);
      choices = [...choices.filter((x) => !(x.payeeKey === c.payeeKey && x.accountId === c.accountId)), { ...c, createdAt: new Date().toISOString() }];
    },
    deleteRecurringChoice: async (_db: unknown, payeeKey: string, accountId: string) => {
      choices = choices.filter((x) => !(x.payeeKey === payeeKey && x.accountId === accountId));
    },
    ...over,
  };
};

describe("the month summary", () => {
  test("shows Expected, Paid and Remaining due, which add up, and every charge in the month", async () => {
    render(<BillsSection dataLayer={layer()} asOfDate="2026-09-10" />);
    expect((await screen.findByTestId("recurring-expected")).textContent).toBe("$60.00");
    expect(screen.getByTestId("recurring-paid").textContent).toBe("$45.00");
    expect(screen.getByTestId("recurring-due").textContent).toBe("$15.00");
    const month = screen.getByTestId("recurring-month");
    expect(within(month).getByTestId("recurring-row-Netflix").textContent).toContain("In 5 days");
    expect(within(month).getByTestId("recurring-row-City Gym").textContent).toContain("Paid Sep 2");
  });

  test("Next month shows next month's charges", async () => {
    render(<BillsSection dataLayer={layer()} asOfDate="2026-09-10" />);
    await screen.findByTestId("recurring-expected");
    fireEvent.change(screen.getByLabelText("Which month"), { target: { value: "next" } });
    expect(screen.getByTestId("recurring-paid").textContent).toBe("$0.00");
    expect(screen.getByTestId("recurring-due").textContent).toBe("$60.00");
  });
});

describe("the money rule", () => {
  // A recurring charge is a cost a month, written plainly, not red parentheses, "($15.00)".
  test("the usual amount is a plain $ figure, never red parentheses", async () => {
    render(<BillsSection dataLayer={layer()} asOfDate="2026-09-10" />);
    await screen.findByTestId("recurring-expected");
    expect(document.body.textContent).toContain("$15.00");
    expect(document.body.textContent).not.toMatch(/\(\$\d/);
    for (const el of document.querySelectorAll("td")) {
      if (/\$\d/.test(el.textContent ?? "")) expect(el.className).not.toMatch(/text-destructive/);
    }
  });
});

describe("all recurring charges", () => {
  const spotify = (accountId: string, cents: number) =>
    run("Spotify", accountId, ["2026-03-15", "2026-04-15", "2026-05-16", "2026-06-15", "2026-07-15", "2026-08-15"], cents);
  const twoSpotifys = () => layer({ getTransactions: async () => [...spotify("a1", 1100), ...spotify("a2", 1000)] });

  test("two charges from the same merchant name their accounts", async () => {
    render(<BillsSection dataLayer={twoSpotifys()} asOfDate="2026-09-01" />);
    const table = await screen.findByTestId("detected-series");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const text = rows.map((r) => r.textContent ?? "");
    expect(text.some((t) => t.includes("Personal Checking (0404)"))).toBe(true);
    // The bank's doubled closing bracket is trimmed for display.
    expect(text.some((t) => t.includes("Rewards Card (0303)") && !t.includes("(0303))"))).toBe(true);
  });

  test("each row says how often, the usual amount, and who found it", async () => {
    const marked = layer({
      getRecurringChoices: async () => [{ payeeKey: "city gym", accountId: "a1", choice: "recurring", cadence: "monthly", label: "City Gym", createdAt: "2026-09-01T00:00:00.000Z" }],
    });
    render(<BillsSection dataLayer={marked} asOfDate="2026-09-10" />);
    const table = await screen.findByTestId("detected-series");
    const netflixRow = within(table).getByText("Netflix").closest("tr")!;
    expect(netflixRow.textContent).toContain("Every month");
    expect(netflixRow.textContent).toContain("$15.00");
    expect(netflixRow.textContent).toContain("the app");
    expect(within(table).getByText("City Gym").closest("tr")!.textContent).toContain("you");
  });

  // ISO dates can wrap mid-number in a narrow column, so dates read short, with the year only when it is not this year.
  test("dates read short, with the year only when it is not this year", async () => {
    const yearly = run("Example Charity", "a1", ["2023-09-29", "2024-09-29", "2025-09-29"], 300, "Charity");
    render(<BillsSection dataLayer={layer({ getTransactions: async () => [...netflix(), ...yearly] })} asOfDate="2026-09-10" />);
    const table = await screen.findByTestId("detected-series");
    const netflixRow = within(table).getByText("Netflix").closest("tr")!;
    expect(netflixRow.textContent).toContain("Aug 15");
    expect(netflixRow.textContent).toContain("Sep 15");
    expect(netflixRow.textContent).not.toContain("2026-");
    expect(within(table).getByText("Example Charity").closest("tr")!.textContent).toContain("Sep 29, 2025");
  });

  test("a charge that missed its date says so in Next", async () => {
    render(<BillsSection dataLayer={layer()} asOfDate="2026-10-01" />);
    const table = await screen.findByTestId("detected-series");
    expect(within(table).getByText("Netflix").closest("tr")!.textContent).toContain("Missed Sep 15");
  });

  test("Not recurring hides a charge and lists it below; Show again brings it back", async () => {
    const data = layer();
    render(<BillsSection dataLayer={data} asOfDate="2026-09-10" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark as not recurring: Netflix" }));
    await waitFor(() => expect(within(screen.getByTestId("detected-series")).queryByText("Netflix")).toBeNull());
    expect(data.saved).toEqual([{ payeeKey: "netflix", accountId: "a1", choice: "not_recurring", cadence: null, label: "Netflix" }]);
    const hidden = screen.getByTestId("recurring-hidden");
    expect(hidden.textContent).toContain("Netflix");
    expect(hidden.textContent).toContain("Personal Checking (0404)");
    fireEvent.click(within(hidden).getByRole("button", { name: "Show again: Netflix" }));
    await waitFor(() => expect(within(screen.getByTestId("detected-series")).getByText("Netflix")).toBeTruthy());
    expect(screen.queryByTestId("recurring-hidden")).toBeNull();
  });

  // The action must read as a button, not a status ("Not recurring"); a "Found by: the app"
  // column on every row told the user nothing.
  test("the row action reads as a button, Mark as not recurring", async () => {
    render(<BillsSection dataLayer={layer()} asOfDate="2026-09-10" />);
    const button = await screen.findByRole("button", { name: "Mark as not recurring: Netflix" });
    expect(button.textContent).toBe("Mark as not recurring");
    expect(button.className).toMatch(/border-border/);
  });

  test("Found by shows only once a charge was marked by hand", async () => {
    render(<BillsSection dataLayer={layer()} asOfDate="2026-09-10" />);
    const table = await screen.findByTestId("detected-series");
    expect(within(table).queryByText("Found by")).toBeNull();
    cleanup();
    const marked = layer({
      getRecurringChoices: async () => [
        { payeeKey: "netflix", accountId: "a1", choice: "recurring", cadence: "monthly", label: "Netflix", createdAt: "2026-09-01T00:00:00.000Z" },
      ],
    });
    render(<BillsSection dataLayer={marked} asOfDate="2026-09-10" />);
    expect(within(await screen.findByTestId("detected-series")).getByText("Found by")).toBeTruthy();
  });

  test("a refused save shows the server's own words and changes nothing", async () => {
    render(
      <BillsSection
        dataLayer={layer({ saveRecurringChoice: async () => { throw new Error("Unknown choice."); } })}
        asOfDate="2026-09-10"
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Mark as not recurring: Netflix" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Unknown choice.");
    expect(within(screen.getByTestId("detected-series")).getByText("Netflix")).toBeTruthy();
  });

  test("a charge's name opens its payments, on every account it was charged on, with Back to Recurring", async () => {
    render(<BillsSection dataLayer={layer()} asOfDate="2026-09-10" />);
    const links = await screen.findAllByRole("link", { name: "Netflix" });
    for (const link of links) {
      const parsed = parseLedgerQuery(new URLSearchParams(link.getAttribute("href")!.split("?")[1]));
      expect(parsed.initialFilter.payeeKey).toBe("netflix");
      expect(parsed.initialFilter.accountIds).toEqual(["a1"]);
      expect(parsed.initialFilter.from).toBeUndefined();
      expect(parsed.ledger).toMatchObject({ back: "#/recurring", view: "series" });
    }
  });
});

describe("the budget checks and the unavailable state", () => {
  test("a charge with no fixed-cost line is listed; so is a fixed cost with no charge", async () => {
    render(
      <BillsSection
        dataLayer={layer({
          getCategorySettings: async () => [{ planningCategory: "Gym Membership", recurring: true, recurringSource: "user", pinned: false }],
        })}
        asOfDate="2026-09-10"
      />
    );
    const unbudgeted = await screen.findByTestId("audit-unbudgeted");
    expect(unbudgeted.textContent).toContain("Recurring charges with no fixed-cost line on your budget");
    expect(unbudgeted.textContent).toContain("Netflix");
    const missing = screen.getByTestId("audit-missing");
    expect(missing.textContent).toContain("Fixed costs on your budget with no recurring charge found");
    expect(missing.textContent).toContain("Gym Membership");
  });

  test("the unavailable message has no dash", async () => {
    render(<BillsSection dataLayer={layer({ loadDb: async () => { throw new Error("down"); } })} asOfDate="2026-09-01" />);
    expect(await screen.findByText("The local server is not reachable. Restart the app.")).toBeTruthy();
  });
});
