import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";

test("set then get category mappings; upsert overwrites", () => {
  const repo = new NodeRepository(":memory:");
  repo.setCategoryMapping("Coffee Shops", "Dining Out");
  repo.setCategoryMapping("Restaurants", "Dining Out");
  repo.setCategoryMapping("Coffee Shops", "Coffee"); // overwrite
  expect(repo.getCategoryMappings()).toEqual({ "Coffee Shops": "Coffee", "Restaurants": "Dining Out" });
});
