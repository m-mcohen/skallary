// tests/data/wishlist-order.test.ts
// The Wish List is ordered by dragging, so the whole order is saved
// at once: position 1 at the top, one transaction.
import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";
import type { WishlistItem } from "../../src/domain/plan-types";

const item = (id: string, priority: number): WishlistItem => ({ id, name: id, costCents: 100, kind: "wish", targetDate: null, priority, planningCategory: null });

function fresh(): NodeRepository {
  const repo = new NodeRepository(":memory:");
  for (const [id, p] of [["a", 2], ["b", 3], ["c", 4]] as const) repo.upsertWishlistItem(item(id, p));
  return repo;
}

test("the order saved is the order read back, numbered from 1", () => {
  const repo = fresh();
  repo.reorderWishlist(["c", "a", "b"]);
  expect(repo.listWishlistItems().map((w) => [w.id, w.priority])).toEqual([["c", 1], ["a", 2], ["b", 3]]);
});

test("a reorder that names an unknown item changes nothing", () => {
  const repo = fresh();
  expect(() => repo.reorderWishlist(["c", "a", "zzz"])).toThrow();
  expect(repo.listWishlistItems().map((w) => [w.id, w.priority])).toEqual([["a", 2], ["b", 3], ["c", 4]]);
});
