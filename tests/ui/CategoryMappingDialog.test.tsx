// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, waitFor, within, screen } from "@testing-library/react";

afterEach(cleanup);
import userEvent from "@testing-library/user-event";

import CategoryMappingDialog, { type CategoryMappingDataLayer } from "../../src/ui/CategoryMappingDialog";
import type { NormalizedTxn } from "../../src/domain/types";
import type { Db } from "../../src/ui/lib/db";

// Two distinct source categories; one already mapped, one not -- exercises both
// the "current mapping" display and the unmapped-falls-through-to-raw-name row.
const TXNS: NormalizedTxn[] = [
  {
    sourceTransactionId: "t1",
    accountId: "acct-a",
    date: "2027-01-15",
    amountCents: -8000,
    sourceCategory: "Coffee Shops",
    merchant: "Cafe",
    isTransfer: false,
    sourceUpdatedAt: null,
  },
  {
    sourceTransactionId: "t2",
    accountId: "acct-a",
    date: "2027-01-16",
    amountCents: -12000,
    sourceCategory: "Restaurants",
    merchant: "Diner",
    isTransfer: false,
    sourceUpdatedAt: null,
  },
];

function makeStubDataLayer(initialMappings: Record<string, string>) {
  let mappings = { ...initialMappings };
  const setCategoryMapping = vi.fn(async (_db: Db, source: string, planning: string) => {
    mappings = { ...mappings, [source]: planning };
  });
  const dataLayer: Partial<CategoryMappingDataLayer> = {
    loadDb: async () => ({}) as Db,
    getTransactions: async () => TXNS,
    getCategoryMappings: async () => mappings,
    setCategoryMapping,
  };
  return { dataLayer, setCategoryMapping };
}

test("lists distinct source categories with their current mapping, and free-text save calls setCategoryMappingUI + refreshes", async () => {
  const { dataLayer, setCategoryMapping } = makeStubDataLayer({ "Coffee Shops": "Dining Out" });

  const { findByText, getByLabelText, getByText } = render(
    <CategoryMappingDialog dataLayer={dataLayer} defaultOpen />
  );

  // Distinct source categories from transactions, each row's current mapping shown
  // (mapped falls to its planning category; unmapped falls through to its raw name).
  await findByText("Coffee Shops");
  expect(getByText("Dining Out")).toBeTruthy();
  await findByText("Restaurants");
  expect(getByText("Restaurants (unmapped)")).toBeTruthy();

  // Pick the planning category for the unmapped row (type to filter) and save.
  const user = userEvent.setup();
  const box = getByLabelText("Planning category for Restaurants") as HTMLInputElement;
  await user.type(box, "Dining");
  await user.click(await screen.findByRole("option", { name: "Dining Out" }));
  const row = box.closest("tr")!;
  await user.click(within(row).getByText("Save"));

  await waitFor(() => {
    expect(setCategoryMapping).toHaveBeenCalledWith(expect.anything(), "Restaurants", "Dining Out");
  });

  // Dialog re-fetches after save: "Restaurants" now shows its new mapping, no longer "(unmapped)".
  await waitFor(() => {
    expect(() => getByText("Restaurants (unmapped)")).toThrow();
  });
});

test("renders a neutral empty state headlessly when the db is unreachable (no local server)", async () => {
  const dataLayer: Partial<CategoryMappingDataLayer> = {
    loadDb: async () => {
      throw new Error("no local server");
    },
  };
  const { findByText } = render(<CategoryMappingDialog dataLayer={dataLayer} defaultOpen />);
  await findByText("Not connected");
});

test("a planning category that does not exist yet can be typed and created, then saved", async () => {
  const { dataLayer, setCategoryMapping } = makeStubDataLayer({ "Coffee Shops": "Dining Out" });
  const { findByText, getByLabelText } = render(<CategoryMappingDialog dataLayer={dataLayer} defaultOpen />);
  await findByText("Restaurants");
  const user = userEvent.setup();
  const box = getByLabelText("Planning category for Restaurants") as HTMLInputElement;
  const row = box.closest("tr")!;
  expect((within(row).getByText("Save") as HTMLButtonElement).disabled).toBe(true);
  await user.type(box, "Eating out");
  await user.click(await screen.findByRole("option", { name: 'Create "Eating out"' }));
  await user.click(within(row).getByText("Save"));
  await waitFor(() => expect(setCategoryMapping).toHaveBeenCalledWith(expect.anything(), "Restaurants", "Eating out"));
});

test("what the box shows is what Save writes: typing after a pick disables Save until a new pick", async () => {
  const { dataLayer, setCategoryMapping } = makeStubDataLayer({ "Coffee Shops": "Dining Out", Groceries: "Groceries" });
  const { findByText, getByLabelText } = render(<CategoryMappingDialog dataLayer={dataLayer} defaultOpen />);
  await findByText("Restaurants");
  const user = userEvent.setup();
  const box = getByLabelText("Planning category for Restaurants") as HTMLInputElement;
  const row = box.closest("tr")!;
  const save = () => within(row).getByText("Save") as HTMLButtonElement;
  await user.type(box, "Groc");
  await user.click(await screen.findByRole("option", { name: "Groceries" }));
  await waitFor(() => expect(box.value).toBe("Groceries"));
  expect(save().disabled).toBe(false);
  await user.type(box, " & Household");
  await waitFor(() => expect(save().disabled).toBe(true));
  await user.click(await screen.findByRole("option", { name: 'Create "Groceries & Household"' }));
  await waitFor(() => expect(save().disabled).toBe(false));
  await user.click(save());
  await waitFor(() => expect(setCategoryMapping).toHaveBeenCalledWith(expect.anything(), "Restaurants", "Groceries & Household"));
});

test("the empty state uses plain words, with no dash", async () => {
  const dataLayer: Partial<CategoryMappingDataLayer> = {
    loadDb: async () => ({}) as Db,
    getTransactions: async () => [],
    getCategoryMappings: async () => ({}),
    setCategoryMapping: vi.fn(),
  };
  const { findByText } = render(<CategoryMappingDialog dataLayer={dataLayer} defaultOpen />);
  expect(await findByText("Import transactions first. Mappings are built from what is in the data.")).toBeTruthy();
});

// Settings, Mappings was one button and nothing else; the
// list now shows when the tab opens.
test("inline, the list shows without a click and there is no button to open it", async () => {
  const { dataLayer } = makeStubDataLayer({ "Coffee Shops": "Dining Out" });
  const { findByText, queryByRole } = render(<CategoryMappingDialog dataLayer={dataLayer} inline />);
  expect(await findByText("Coffee Shops")).toBeTruthy();
  expect(queryByRole("button", { name: "Manage category mappings" })).toBeNull();
  expect(await findByText("Category mappings")).toBeTruthy();
});
