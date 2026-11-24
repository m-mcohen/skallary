import { expect, test } from "vitest";


const cum = [
  { period: "2027-01", cents: 30000 },
  { period: "2027-02", cents: 70000 },
  { period: "2027-03", cents: 130000 },
];

test("wishlistTotal sums every item, planned and wish, and splits the count", async () => {
  const { wishlistTotal } = await import("../../src/domain/wishlist");
  const items = [
    { id: "a", name: "A", costCents: 12345, kind: "wish" as const, targetDate: null, priority: 1, planningCategory: null },
    { id: "b", name: "B", costCents: 50000, kind: "planned" as const, targetDate: "2027-01-01", priority: 2, planningCategory: null },
    { id: "c", name: "C", costCents: 5, kind: "wish" as const, targetDate: null, priority: 3, planningCategory: null },
  ];
  expect(wishlistTotal(items)).toEqual({ totalCents: 62350, count: 3 });
  expect(wishlistTotal([])).toEqual({ totalCents: 0, count: 0 });
});
