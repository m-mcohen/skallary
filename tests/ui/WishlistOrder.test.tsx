// @vitest-environment jsdom
// tests/ui/WishlistOrder.test.tsx
// The request: "Instead of typing in a priority number for my wishlist, let me
// drag to reorder." Each row has a grip handle (mouse, touch, or keyboard: Space to pick
// up, arrows to move, Space to drop); the list's order is the order wishes are served in.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within, act } from "@testing-library/react";
import WishlistSection, { type WishlistDataLayer } from "../../src/ui/WishlistSection";
import type { BudgetLine, Plan, WishlistItem } from "../../src/domain/plan-types";
import type { Db } from "../../src/ui/lib/db";

const item = (id: string, name: string, priority: number): WishlistItem => ({ id, name, costCents: 10_000, kind: "wish", targetDate: null, priority, planningCategory: null });
const PLAN: Plan = { id: "plan1", name: "2026 Plan", startDate: "2026-01-01", endDate: "2026-12-31", createdAt: "" };
const LINES: BudgetLine[] = [{ planId: "plan1", planningCategory: "Income", period: null, amountCents: 500_000 }];

function layer(initial: WishlistItem[], reorder?: (ids: string[]) => Promise<void>) {
  let items = [...initial];
  const dl: Partial<WishlistDataLayer> = {
    loadDb: async () => ({}) as Db,
    listWishlistItems: vi.fn(async () => [...items].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))),
    upsertWishlistItem: vi.fn(async (_db: Db, w: WishlistItem) => {
      items = [...items.filter((x) => x.id !== w.id), w];
    }),
    deleteWishlistItem: vi.fn(async () => {}),
    reorderWishlist: vi.fn(async (_db: Db, ids: string[]) => {
      if (reorder) return reorder(ids);
      items = ids.map((id, i) => ({ ...items.find((x) => x.id === id)!, priority: i + 1 }));
    }),
    getTransactions: async () => [],
    getAccounts: async () => [],
    getCategoryMappings: async () => ({}),
    getPlan: async () => PLAN,
    getBudgetLines: async () => LINES,
    getTransactionAdjustments: async () => [],
  };
  return dl;
}

const THREE = [item("a", "Couch", 2), item("b", "Bike", 3), item("c", "Camera", 4)];

// jsdom has no layout, so dnd-kit's keyboard sensor cannot measure rows. Give each
// sortable row a rect by its place in the table, 40 px apart.
let rectSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const row = this.closest("[data-wish-row]") as HTMLElement | null;
    const i = row ? Number(row.getAttribute("data-wish-row")) : 0;
    const top = i * 40;
    return { x: 0, y: top, top, left: 0, right: 600, bottom: top + 40, width: 600, height: 40, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => {
  rectSpy.mockRestore();
  cleanup();
});

const names = () => screen.getAllByTestId("wish-row").map((r) => within(r).getByTestId("wish-name").textContent);

// Two mounts in one test doubled the cold-start cost that ran past the time limit under load; one mount each.
test("every row has a drag handle and shows its place in the list", async () => {
  render(<WishlistSection dataLayer={layer(THREE)} planId="plan1" asOfDate="2025-12-01" />);
  await waitFor(() => expect(names()).toEqual(["Couch", "Bike", "Camera"]));
  expect(screen.getByRole("button", { name: "Drag to reorder Couch" })).toBeTruthy();
  expect(screen.getAllByTestId("wish-order").map((c) => c.textContent)).toEqual(["1", "2", "3"]);
});

test("the dialog has no priority box", async () => {
  render(<WishlistSection dataLayer={layer(THREE)} planId="plan1" asOfDate="2025-12-01" defaultDialogOpen />);
  await screen.findByLabelText("Name");
  expect(screen.queryByLabelText("Priority")).toBeNull();
});

test("a new item goes to the bottom of the list", async () => {
  const dl = layer(THREE);
  render(<WishlistSection dataLayer={dl} planId="plan1" asOfDate="2025-12-01" defaultDialogOpen />);
  await waitFor(() => expect(names()).toHaveLength(3));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Tent" } });
  fireEvent.change(screen.getByLabelText(/Cost/), { target: { value: "300" } });
  fireEvent.click(screen.getByRole("button", { name: "Save item" }));
  await waitFor(() => expect(dl.upsertWishlistItem).toHaveBeenCalled());
  const saved = (dl.upsertWishlistItem as ReturnType<typeof vi.fn>).mock.calls[0][1] as WishlistItem;
  expect(saved.priority).toBe(5); // one past the last (4)
  await waitFor(() => expect(names()).toEqual(["Couch", "Bike", "Camera", "Tent"]));
});

const tick = () => new Promise((r) => setTimeout(r, 30));

async function moveDownByKeyboard(name: string, steps: number) {
  const handle = screen.getByRole("button", { name: `Drag to reorder ${name}` });
  handle.focus();
  await act(async () => {
    fireEvent.keyDown(handle, { key: " ", code: "Space" });
    await tick();
  });
  for (let i = 0; i < steps; i++) {
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? handle, { key: "ArrowDown", code: "ArrowDown" });
      await tick();
    });
  }
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? handle, { key: " ", code: "Space" });
    await tick();
  });
}

test("moving a row saves the whole order at once, and the list follows", async () => {
  const dl = layer(THREE);
  render(<WishlistSection dataLayer={dl} planId="plan1" asOfDate="2025-12-01" />);
  await waitFor(() => expect(names()).toEqual(["Couch", "Bike", "Camera"]));
  await moveDownByKeyboard("Couch", 2);
  await waitFor(() => expect(dl.reorderWishlist).toHaveBeenCalledWith(expect.anything(), ["b", "c", "a"]));
  await waitFor(() => expect(names()).toEqual(["Bike", "Camera", "Couch"]));
  expect(screen.getAllByTestId("wish-order").map((c) => c.textContent)).toEqual(["1", "2", "3"]);
});

test("a refused save puts the list back and says why", async () => {
  const dl = layer(THREE, async () => {
    throw new Error("The Wish List changed since this screen loaded. Reload and try again.");
  });
  render(<WishlistSection dataLayer={dl} planId="plan1" asOfDate="2025-12-01" />);
  await waitFor(() => expect(names()).toEqual(["Couch", "Bike", "Camera"]));
  await moveDownByKeyboard("Couch", 1);
  expect(await screen.findByText("Order not saved: The Wish List changed since this screen loaded. Reload and try again.")).toBeTruthy();
  expect(names()).toEqual(["Couch", "Bike", "Camera"]);
});

// An item deleted while a reorder was pending came back
// on screen when the stale reorder was then refused. A refusal now reloads the list.
test("a refused save shows the list as it is now, not as it was before the drag", async () => {
  const dl = layer(THREE, async () => {
    // Camera is deleted while this reorder is in flight, then the stale order is refused.
    (dl.listWishlistItems as ReturnType<typeof vi.fn>).mockImplementation(async () => [item("a", "Couch", 2), item("b", "Bike", 3)]);
    throw new Error("The Wish List changed since this screen loaded. Reload and try again.");
  });
  render(<WishlistSection dataLayer={dl} planId="plan1" asOfDate="2025-12-01" />);
  await waitFor(() => expect(names()).toEqual(["Couch", "Bike", "Camera"]));
  await moveDownByKeyboard("Couch", 1);
  expect(await screen.findByText("Order not saved: The Wish List changed since this screen loaded. Reload and try again.")).toBeTruthy();
  await waitFor(() => expect(names()).toEqual(["Couch", "Bike"]));
});
