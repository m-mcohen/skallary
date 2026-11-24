// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { render, waitFor, fireEvent, cleanup, within } from "@testing-library/react";

import WishlistSection, { type WishlistDataLayer } from "../../src/ui/WishlistSection";

// Same rationale as GoalsSection.test.tsx: multiple tests render rows for the
// same item name, so explicit cleanup avoids cross-test DOM collisions
// (vitest.config.ts has no `globals: true`, so @testing-library/react's
// implicit afterEach(cleanup) registration doesn't fire).
afterEach(cleanup);

import type { WishlistItem, Plan, BudgetLine } from "../../src/domain/plan-types";
import type { NormalizedTxn, Account } from "../../src/domain/types";
import type { Db } from "../../src/ui/lib/db";

const WISH_ITEM: WishlistItem = {
  id: "w1",
  name: "New couch",
  costCents: 200000,
  kind: "wish",
  targetDate: null,
  priority: 1,
  planningCategory: null,
};

const PLANNED_ITEM: WishlistItem = {
  id: "p1",
  name: "Roof repair",
  costCents: 500000,
  kind: "planned",
  targetDate: "2026-10-01",
  priority: 0,
  planningCategory: "Home",
};

const PLAN: Plan = {
  id: "plan1",
  name: "2026 Plan",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  createdAt: "2026-01-01T00:00:00Z",
};

// The data layer accepts plan and budget inputs even for a one-time item.
const BUDGET_LINES: BudgetLine[] = [
  { planId: "plan1", planningCategory: "Income", period: null, amountCents: 500000 },
];

const BEFORE_PLAN_START = "2025-12-01";

function makeStubDataLayer(initial: WishlistItem[], opts?: { plan?: Plan | null }) {
  let items = [...initial];
  const listWishlistItems = vi.fn(async () => items);
  const upsertWishlistItem = vi.fn(async (_db: Db, w: WishlistItem) => {
    const idx = items.findIndex((x) => x.id === w.id);
    if (idx >= 0) items[idx] = w;
    else items = [...items, w];
  });
  const deleteWishlistItem = vi.fn(async (_db: Db, id: string) => {
    items = items.filter((w) => w.id !== id);
  });
  const dataLayer: Partial<WishlistDataLayer> = {
    loadDb: async () => ({}) as Db,
    listWishlistItems,
    upsertWishlistItem,
    deleteWishlistItem,
    getTransactions: async () => [] as NormalizedTxn[],
    getAccounts: async () => [] as Account[],
    getCategoryMappings: async () => ({}),
    getPlan: async () => (opts?.plan === undefined ? PLAN : opts.plan),
    getBudgetLines: async () => BUDGET_LINES,
    getTransactionAdjustments: async () => [],
  };
  return { dataLayer, listWishlistItems, upsertWishlistItem, deleteWishlistItem };
}

test("add item dialog converts dollars to cents and calls upsertWishlistItemUI, then re-fetches", async () => {
  const { dataLayer, upsertWishlistItem } = makeStubDataLayer([], { plan: null });
  const { findByText, getByText, getByLabelText, findByLabelText } = render(
    <WishlistSection dataLayer={dataLayer} planId={null} defaultDialogOpen />
  );

  await findByText("No wishlist items yet");

  // Wait for the dialog before entering the item.
  fireEvent.change(await findByLabelText("Name"), { target: { value: "Kayak" } });
  fireEvent.change(getByLabelText("Cost"), { target: { value: "750" } });
  fireEvent.click(getByText("Save item"));

  await waitFor(() => {
    expect(upsertWishlistItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "Kayak", costCents: 75000, kind: "wish" })
    );
  });
  await findByText("Kayak");
});

test("delete calls deleteWishlistItemUI and the list re-fetches to empty", async () => {
  const { dataLayer, deleteWishlistItem } = makeStubDataLayer([WISH_ITEM], { plan: null });
  const { findByText, getByRole } = render(<WishlistSection dataLayer={dataLayer} planId={null} />);

  await findByText("New couch");
  fireEvent.click(getByRole("button", { name: "Delete New couch" }));
  // The item stays in the list until deletion is confirmed.
  await findByText("Delete New couch?");
  expect(deleteWishlistItem).not.toHaveBeenCalled();
  fireEvent.click(getByRole("button", { name: "Delete item" }));

  await waitFor(() => {
    expect(deleteWishlistItem).toHaveBeenCalledWith(expect.anything(), "w1");
  });
  await findByText("No wishlist items yet");
});

test("renders a neutral empty state headlessly when the db is unreachable (no local server)", async () => {
  const dataLayer: Partial<WishlistDataLayer> = {
    loadDb: async () => {
      throw new Error("no local server");
    },
  };
  const { findByText } = render(<WishlistSection dataLayer={dataLayer} planId={null} />);
  await findByText("Not connected");
});

test("the table footer shows the running total of every item", async () => {
  const { dataLayer } = makeStubDataLayer([PLANNED_ITEM, WISH_ITEM], { plan: null });
  const { findByText, container } = render(<WishlistSection dataLayer={dataLayer} planId={null} />);
  await findByText("Roof repair");
  const footer = container.querySelector("tfoot") as HTMLElement;
  expect(within(footer).getByText("Total")).toBeTruthy();
  expect(within(footer).getByText("$7,000")).toBeTruthy();
});

// Row controls have accessible names. The full item name is available on hover.
const LONG_NAME = "Replacement shelves and colorful storage bins for the community workshop supply cabinet";

test("Edit is an icon button named for its item, with no visible word, and opens the dialog", async () => {
  const { dataLayer } = makeStubDataLayer([WISH_ITEM], { plan: null });
  const { findByText, getByRole, findByLabelText } = render(<WishlistSection dataLayer={dataLayer} planId={null} />);
  await findByText("New couch");
  const edit = getByRole("button", { name: "Edit New couch" });
  expect(edit.textContent).toBe("");
  expect(edit.getAttribute("title")).toBe("Edit New couch");
  expect(edit.querySelector("svg")).not.toBeNull();
  fireEvent.click(edit);
  expect(((await findByLabelText("Name")) as HTMLInputElement).value).toBe("New couch");
});

test("Delete carries a hover label too", async () => {
  const { dataLayer } = makeStubDataLayer([WISH_ITEM], { plan: null });
  const { findByText, getByRole } = render(<WishlistSection dataLayer={dataLayer} planId={null} />);
  await findByText("New couch");
  expect(getByRole("button", { name: "Delete New couch" }).getAttribute("title")).toBe("Delete New couch");
});

test("a long name is shortened by the layout, not cut: the whole name stays in the cell and on hover", async () => {
  const { dataLayer } = makeStubDataLayer([{ ...WISH_ITEM, name: LONG_NAME }], { plan: null });
  const { findByTestId } = render(<WishlistSection dataLayer={dataLayer} planId={null} />);
  const cell = await findByTestId("wish-name");
  expect(cell.textContent).toBe(LONG_NAME);
  const shown = cell.firstElementChild as HTMLElement;
  expect(shown.getAttribute("title")).toBe(LONG_NAME);
  expect(shown.className).toMatch(/\btruncate\b/);
});
