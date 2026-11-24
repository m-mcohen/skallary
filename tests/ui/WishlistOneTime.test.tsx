// @vitest-environment jsdom
// tests/ui/WishlistOneTime.test.tsx
// The request: "The wish list is generally one time items - it doesn't need a kind
// toggle, date, horizon, or fit in the forecast." The Wish List is a name, a cost and an order.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import WishlistSection, { type WishlistDataLayer } from "../../src/ui/WishlistSection";
import type { WishlistItem } from "../../src/domain/plan-types";
import type { Db } from "../../src/ui/lib/db";

afterEach(cleanup);

const item = (id: string, name: string, priority: number): WishlistItem => ({ id, name, costCents: 10_000, kind: "wish", targetDate: null, priority, planningCategory: null });

function layer(initial: WishlistItem[]) {
  let items = [...initial];
  const forecastReads = { getTransactions: vi.fn(async () => []), getPlan: vi.fn(async () => null), getBudgetLines: vi.fn(async () => []) };
  const dl = {
    loadDb: async () => ({}) as Db,
    listWishlistItems: vi.fn(async () => [...items].sort((a, b) => a.priority - b.priority)),
    upsertWishlistItem: vi.fn(async (_db: Db, w: WishlistItem) => {
      items = [...items.filter((x) => x.id !== w.id), w];
    }),
    deleteWishlistItem: vi.fn(async () => {}),
    reorderWishlist: vi.fn(async () => {}),
    ...forecastReads,
  } as unknown as Partial<WishlistDataLayer>;
  return { dl, forecastReads };
}

const TWO = [item("a", "Couch", 1), item("b", "Camera", 2)];

test("the list is an order, a name, a cost and actions: no kind, no date, no affordability", async () => {
  render(<WishlistSection dataLayer={layer(TWO).dl} planId="plan1" />);
  await waitFor(() => expect(screen.getAllByTestId("wish-row")).toHaveLength(2));
  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Order", "Name", "Cost", "Actions"]);
  expect(screen.queryByRole("switch")).toBeNull();
  expect(document.body.textContent).not.toMatch(/Planned|Not within horizon|Affordable|No date|forecast|surplus/i);
});

test("the Add dialog asks only for a name and a cost, and saves a plain one-time item", async () => {
  const { dl } = layer(TWO);
  render(<WishlistSection dataLayer={dl} planId="plan1" defaultDialogOpen />);
  await screen.findByLabelText("Name");
  expect(screen.getByLabelText("Cost")).toBeTruthy();
  for (const gone of ["Kind", "Target date (optional)", "Planning category (optional)"]) expect(screen.queryByLabelText(gone)).toBeNull();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Tent" } });
  fireEvent.change(screen.getByLabelText("Cost"), { target: { value: "300" } });
  fireEvent.click(screen.getByRole("button", { name: "Save item" }));
  await waitFor(() => expect(dl.upsertWishlistItem).toHaveBeenCalled());
  expect((dl.upsertWishlistItem as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ name: "Tent", costCents: 30_000, kind: "wish", targetDate: null, planningCategory: null, priority: 3 });
});

test("the screen never reads the budget or the transactions: nothing here feeds the forecast", async () => {
  const { dl, forecastReads } = layer(TWO);
  render(<WishlistSection dataLayer={dl} planId="plan1" />);
  await waitFor(() => expect(screen.getAllByTestId("wish-row")).toHaveLength(2));
  await new Promise((r) => setTimeout(r, 50));
  expect(forecastReads.getTransactions).not.toHaveBeenCalled();
  expect(forecastReads.getPlan).not.toHaveBeenCalled();
  expect(forecastReads.getBudgetLines).not.toHaveBeenCalled();
});

test("the total still adds every item", async () => {
  render(<WishlistSection dataLayer={layer(TWO).dl} planId="plan1" />);
  await waitFor(() => expect(screen.getAllByTestId("wish-row")).toHaveLength(2));
  expect(screen.getByText("$200")).toBeTruthy();
});
