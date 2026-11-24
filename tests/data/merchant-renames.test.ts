import { describe, expect, test } from "vitest";
import { NodeRepository } from "../../src/data/repo.node";

describe("the repository", () => {
  test("a rename is saved, read back, replaced by a second save of the same bank name (any case), and removed", () => {
    const repo = new NodeRepository(":memory:");
    expect(repo.listMerchantRenames()).toEqual([]);
    repo.upsertMerchantRename({ sourceName: "Toy Shop", displayName: "Toy Store", createdAt: "2026-10-02T12:00:00.000Z" });
    expect(repo.listMerchantRenames()).toEqual([{ sourceName: "Toy Shop", displayName: "Toy Store", createdAt: "2026-10-02T12:00:00.000Z" }]);
    repo.upsertMerchantRename({ sourceName: "toy shop", displayName: "Toy Store", createdAt: "2026-10-02T13:00:00.000Z" });
    expect(repo.listMerchantRenames()).toEqual([{ sourceName: "toy shop", displayName: "Toy Store", createdAt: "2026-10-02T13:00:00.000Z" }]);
    repo.deleteMerchantRename("TOY SHOP");
    expect(repo.listMerchantRenames()).toEqual([]);
  });

  test("a dismissal is kept until Show again removes it", () => {
    const repo = new NodeRepository(":memory:");
    const d = { id: "same-letters|TOY BOX|Toy Box", kind: "same-letters" as const, fromName: "TOY BOX", intoName: "Toy Box", createdAt: "2026-10-02T12:00:00.000Z" };
    repo.addSuggestionDismissal(d);
    repo.addSuggestionDismissal({ ...d, createdAt: "2026-10-02T14:00:00.000Z" });
    expect(repo.listSuggestionDismissals()).toEqual([d]);
    repo.deleteSuggestionDismissal(d.id);
    expect(repo.listSuggestionDismissals()).toEqual([]);
  });
});
