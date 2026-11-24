import { expect, test, describe } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";
import type { CategorizationRule } from "../../src/domain/rules";

const rule: Omit<CategorizationRule, "id"> = {
  priority: 100, memoContains: "BOOK ORDER", amountCents: -2000,
  action: "categorize", toCategory: "Books", note: "Toy bookshop order",
};

describe("categorization rules persistence", () => {
  test("round-trips a rule with all its match conditions", () => {
    const repo = new NodeRepository(":memory:");
    const id = repo.addCategorizationRule(rule);
    const [saved] = repo.getCategorizationRules();
    expect(saved).toEqual({ ...rule, id, payeeContains: null, descriptionContains: null, mcc: null, accountId: null, amountMinCents: null, amountMaxCents: null });
  });

  test("returns rules in priority order so first-match-wins is deterministic", () => {
    const repo = new NodeRepository(":memory:");
    repo.addCategorizationRule({ ...rule, priority: 500, toCategory: "Learned" });
    repo.addCategorizationRule({ ...rule, priority: 100, toCategory: "HandWritten" });
    expect(repo.getCategorizationRules().map((r) => r.toCategory)).toEqual(["HandWritten", "Learned"]);
  });

  test("deletes a rule", () => {
    const repo = new NodeRepository(":memory:");
    const id = repo.addCategorizationRule(rule);
    repo.deleteCategorizationRule(id);
    expect(repo.getCategorizationRules()).toHaveLength(0);
  });

  test("bulk-inserts learned rules without disturbing hand-written ones", () => {
    const repo = new NodeRepository(":memory:");
    repo.addCategorizationRule(rule);
    repo.addCategorizationRules([
      { priority: 500, payeeContains: "Toy Market", action: "categorize", toCategory: "Groceries" },
      { priority: 500, payeeContains: "Toy Depot", action: "categorize", toCategory: "Household" },
    ]);
    expect(repo.getCategorizationRules()).toHaveLength(3);
    expect(repo.getCategorizationRules()[0].toCategory).toBe("Books");
  });
});
