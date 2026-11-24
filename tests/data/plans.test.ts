import { expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";

test("create, get, list plans", () => {
  const repo = new NodeRepository(":memory:");
  const p = repo.createPlan({ id: "2027-base", name: "2027 Base", startDate: "2027-01-01", endDate: "2027-12-31" });
  expect(p.id).toBe("2027-base");
  expect(p.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(repo.getPlan("2027-base")?.name).toBe("2027 Base");
  expect(repo.getPlan("nope")).toBeNull();
  expect(repo.listPlans().map((x) => x.id)).toEqual(["2027-base"]);
});
