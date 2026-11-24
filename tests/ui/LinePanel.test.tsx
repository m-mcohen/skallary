// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetMonth from "../../src/ui/budget/BudgetMonth";
import { makeBudgetLayer, PLAN, TODAY } from "./budget-fixtures";
import type { BudgetChange } from "../../src/domain/plan-types";

beforeAll(() => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  // @ts-expect-error jsdom polyfill
  global.ResizeObserver = RO;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => cleanup());

const change: BudgetChange = { id: 1, planId: PLAN.id, planningCategory: "Groceries", fromMonth: "2026-10", amountCents: 90000, reason: "changed", goalId: null, createdAt: "" };

async function openPanel(line: string, over = {}) {
  const user = userEvent.setup();
  const made = makeBudgetLayer(over);
  render(<BudgetMonth planId={PLAN.id} dataLayer={made.layer} today={TODAY} />);
  const row = await screen.findByRole("row", { name: new RegExp(`^${line}\\b`) });
  await user.click(within(row).getByRole("button", { name: line }));
  return { user, panel: await screen.findByRole("region", { name: line }), ...made };
}

test("the panel shows the figures, the chart and the buttons", async () => {
  const { panel } = await openPanel("Groceries");
  expect(within(panel).getByText("October so far")).toBeTruthy();
  expect(within(panel).getByText("Heading for")).toBeTruthy();
  expect(within(panel).getByText("12-month average")).toBeTruthy();
  expect(within(panel).getByRole("button", { name: "Change budget" })).toBeTruthy();
  const see = within(panel).getByRole("link", { name: "See transactions" }) as HTMLAnchorElement;
  expect(see.getAttribute("href")).toContain("cat=Groceries");
  expect(see.getAttribute("href")).toContain("from=2026-10-01");
  expect(within(panel).queryByRole("button", { name: "Go back to suggested" })).toBeNull();
});

test("a line with changes lists them and offers Go back to suggested", async () => {
  const { panel } = await openPanel("Groceries", { changes: [change] });
  expect(within(panel).getByText("$900.00 from October 2026, something changed")).toBeTruthy();
  expect(within(panel).getByRole("button", { name: "Go back to suggested" })).toBeTruthy();
});

test("the note: shown, edited, and an empty note deletes it", async () => {
  const { user, panel, layer } = await openPanel("Groceries");
  expect(within(panel).getByText("Party")).toBeTruthy();
  await user.click(within(panel).getByRole("button", { name: "Edit note" }));
  const box = within(panel).getByRole("textbox", { name: "Note for October 2026" });
  await user.clear(box);
  await user.click(within(panel).getByRole("button", { name: "Save note" }));
  expect(layer.setMonthNote).toHaveBeenCalledWith(expect.anything(), PLAN.id, "Groceries", "2026-10", "");
});

test("the fixed-cost switch saves the choice", async () => {
  const { user, panel, layer } = await openPanel("Groceries");
  await user.click(within(panel).getByRole("switch", { name: "Fixed cost" }));
  expect(layer.setCategoryRecurring).toHaveBeenCalledWith(expect.anything(), "Groceries", true);
});

test("Paychecks has no Change budget (it reads Settings)", async () => {
  const { panel } = await openPanel("Paychecks");
  expect(within(panel).queryByRole("button", { name: "Change budget" })).toBeNull();
  expect(within(panel).queryByRole("switch", { name: "Fixed cost" })).toBeNull();
});

test("a finished month's panel is history only: no Change budget", async () => {
  const user = userEvent.setup();
  const made = makeBudgetLayer();
  render(<BudgetMonth planId={PLAN.id} dataLayer={made.layer} today={TODAY} />);
  await screen.findByRole("table", { name: "Budget for October 2026" });
  await user.click(screen.getByRole("button", { name: /previous month/i }));
  const row = await screen.findByRole("row", { name: /^Groceries\b/ });
  await user.click(within(row).getByRole("button", { name: "Groceries" }));
  const panel = await screen.findByRole("region", { name: "Groceries" });
  expect(within(panel).getByText("12 months to September 2026")).toBeTruthy();
  expect(within(panel).queryByRole("button", { name: "Change budget" })).toBeNull();
});

test("in a finished budget year the panel offers no Go back to suggested, Change budget or big month (23b)", async () => {
  const user = userEvent.setup();
  const made = makeBudgetLayer({ changes: [change] });
  render(<BudgetMonth planId={PLAN.id} dataLayer={made.layer} today="2027-01-15" />);
  const row = await screen.findByRole("row", { name: /^Groceries\b/ });
  await user.click(within(row).getByRole("button", { name: "Groceries" }));
  const panel = await screen.findByRole("region", { name: "Groceries" });
  expect(within(panel).queryByRole("button", { name: "Go back to suggested" })).toBeNull();
  expect(within(panel).queryByRole("button", { name: "Change budget" })).toBeNull();
  expect(within(panel).queryByRole("button", { name: "Add a big month" })).toBeNull();
});

// The panel used to open below the whole table, so the page had to be scrolled down to it and back
// up. It now opens in a row right under the line clicked, like expand and collapse.
test("the panel opens in the row right under the line clicked, inside the table, one at a time", async () => {
  const { user, panel } = await openPanel("Groceries");
  const panelRow = panel.closest("tr")!;
  expect(panelRow).toBeTruthy();
  expect(panelRow.closest("table")).toBe(screen.getByRole("table", { name: "Budget for October 2026" }));
  expect(panelRow.previousElementSibling?.getAttribute("aria-label")).toBe("Groceries");
  expect(panelRow.querySelector("td")!.getAttribute("colspan")).toBe("6");
  // Another line: its panel moves under it, and only one is open.
  const rent = screen.getByRole("row", { name: /^Rent\b/ });
  await user.click(within(rent).getByRole("button", { name: "Rent" }));
  const rentPanel = await screen.findByRole("region", { name: "Rent" });
  expect(rentPanel.closest("tr")!.previousElementSibling?.getAttribute("aria-label")).toBe("Rent");
  expect(screen.queryByRole("region", { name: "Groceries" })).toBeNull();
  // Close folds it away.
  await user.click(within(rentPanel).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("region", { name: "Rent" })).toBeNull();
});

// The charity pot: the Charity line's panel shows the budget year's ledger, layout C.
import { TXNS } from "./budget-fixtures";
import type { Account, NormalizedTxn } from "../../src/domain/types";
const POT: Account = { id: "pot", name: "Giving", type: "depository", institution: null, currency: "USD", isOwned: true, includeInSpend: false, owner: "me", maaserPot: true, balanceCents: 420000, balanceDate: "2026-10-19" };
let p = 0;
const potRow = (date: string, amountCents: number, over: Partial<NormalizedTxn> = {}): NormalizedTxn => ({
  sourceTransactionId: `p${++p}`, accountId: "pot", date, amountCents, sourceCategory: "Transfer", merchant: null, isTransfer: true, sourceUpdatedAt: null, ...over,
});
const gift = (date: string, amountCents: number): NormalizedTxn => ({ ...potRow(date, amountCents, { accountId: "checking", sourceCategory: "Charity", isTransfer: false }) });
const CHECKING_ACCT = { id: "checking", name: "Pinecrest Checking", type: null, institution: null, currency: "USD", isOwned: true, includeInSpend: true, owner: "me" as const };
const ledgerFixture = {
  accounts: [CHECKING_ACCT, POT],
  txns: [
    ...TXNS,
    potRow("2026-09-02", 90000, { isTransfer: false, sourceCategory: "Maaser" }),
    potRow("2026-10-02", 90000, { isTransfer: false, sourceCategory: "Maaser" }),
    gift("2026-10-08", -80000),
    potRow("2026-10-09", -50000, { transferPartnerAccountId: "checking" }),
    potRow("2026-10-09", 50000, { accountId: "checking", transferPartnerAccountId: "pot" }),
    potRow("2026-10-18", -20000, { isTransfer: false, sourceCategory: null, description: "ZELLE PAYMENT TO A CHARITY" }),
  ],
  lines: [{ planId: PLAN.id, planningCategory: "Charity", period: null, amountCents: 90000, source: "suggested" as const }],
  maaserFloorCents: 150000,
};

test("the Charity panel shows the charity ledger for all time, the two judgment figures first (layout C)", async () => {
  const { panel } = await openPanel("Charity", ledgerFixture);
  const ledger = within(panel).getByRole("group", { name: "Charity ledger" });
  const figure = (label: string) => within(ledger).getByText(label).nextElementSibling?.textContent;
  expect(figure("Charity available")).toContain("$2,700.00");
  expect(within(ledger).getByText(/balance \$4,200\.00 on Oct 19 less the \$1,500\.00 floor/)).toBeTruthy();
  expect(figure("Owed from income")).toBe("$5,380.00");
  expect(figure("Set aside")).toBe("$1,800.00");
  expect(figure("Not yet set aside")).toBe("$3,580.00");
  expect(figure("Given, from your cards and checking")).toBe("$800.00");
  expect(figure("Given, straight from the pot")).toBe("$200.00");
  expect(figure("Paid back from the pot")).toBe("$500.00");
  expect(figure("The pot owes you")).toBe("$300.00");
  expect(figure("Given beyond Charity")).toBe("$0.00");
  expect(within(ledger).getByText("Spent on this line is what reached a charity this month. The figures below are the Charity ledger since January 2024, when your records begin.")).toBeTruthy();
  expect(within(panel).getByText("October so far").nextElementSibling?.textContent).toBe("$1,000.00");
});

test("every ledger figure opens the rows behind it, over the budget year to date", async () => {
  const { panel } = await openPanel("Charity", ledgerFixture);
  const ledger = within(panel).getByRole("group", { name: "Charity ledger" });
  const href = (label: string) => (within(ledger).getByText(label).nextElementSibling?.querySelector("a") as HTMLAnchorElement).getAttribute("href") ?? "";
  const figures = (label: string) => new URLSearchParams(href(label).split("?")[1]).getAll("maaser");
  expect(figures("Owed from income")).toEqual(["income"]);
  expect(figures("Set aside")).toEqual(["setAside"]);
  expect(figures("Not yet set aside")).toEqual(["income", "setAside"]);
  expect(figures("Given, from your cards and checking")).toEqual(["givenCards"]);
  expect(figures("Given, straight from the pot")).toEqual(["givenPot"]);
  expect(figures("Paid back from the pot")).toEqual(["reimbursed"]);
  expect(figures("The pot owes you")).toEqual(["givenCards", "reimbursed"]);
  expect(figures("Given beyond Charity")).toEqual(["givenCards", "reimbursed"]);
  const q = new URLSearchParams(href("Set aside").split("?")[1]);
  expect(q.get("from")).toBe("2024-01-10");
  expect(q.get("to")).toBe("2026-10-20");
  expect(q.get("transfers")).toBe("include");
  expect(href("Charity available")).toContain("account=pot");
});

test("set aside ahead of income, and paid back ahead, read as ahead, never as a debt", async () => {
  const { panel } = await openPanel("Charity", { ...ledgerFixture, txns: [potRow("2026-10-02", 900000, { isTransfer: false, sourceCategory: "Maaser" }), potRow("2026-10-09", -50000, { transferPartnerAccountId: "checking" })] });
  const ledger = within(panel).getByRole("group", { name: "Charity ledger" });
  expect(within(ledger).getByText("Set aside ahead by").nextElementSibling?.textContent).toBe("$8,100.00");
  expect(within(ledger).getByText("Paid back ahead by").nextElementSibling?.textContent).toBe("$500.00");
});

test("a not-for-the-pot mark leaves the gift out of the ledger but on the line", async () => {
  const marked = ledgerFixture.txns.find((t) => t.sourceCategory === "Charity" && t.accountId === "checking")!;
  const { panel } = await openPanel("Charity", { ...ledgerFixture, maaserMarks: [{ sourceTransactionId: marked.sourceTransactionId, kind: "not_maaser", countedCents: null, updatedAt: "" }] });
  const ledger = within(panel).getByRole("group", { name: "Charity ledger" });
  expect(within(ledger).getByText("Given, from your cards and checking").nextElementSibling?.textContent).toBe("$0.00");
  expect(within(panel).getByText("October so far").nextElementSibling?.textContent).toBe("$1,000.00");
});

test("a pot with no activity this year shows zeros, not the pick-an-account line ", async () => {
  const { panel } = await openPanel("Charity", { ...ledgerFixture, txns: TXNS });
  expect(within(panel).getByRole("group", { name: "Charity ledger" })).toBeTruthy();
  expect(within(panel).getByText("Set aside").nextElementSibling?.textContent).toBe("$0.00");
  expect(within(panel).queryByText(/Pick the account you set it aside in/)).toBeNull();
});

test("no pot account yet: the Charity panel shows owed against given, and says where to pick one", async () => {
  const { panel } = await openPanel("Charity", { lines: ledgerFixture.lines });
  const ledger = within(panel).getByRole("group", { name: "Charity ledger" });
  expect(within(ledger).getByText(/Pick the account you set it aside in, under Settings, Accounts/)).toBeTruthy();
  expect(within(ledger).queryByText("Charity available")).toBeNull();
});
