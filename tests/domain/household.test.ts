// tests/domain/household.test.ts
import { expect, test } from "vitest";
import { toOwnerSlot } from "../../src/domain/household";

test("an owner code outside the three slots reads as the partner slot", () => {
  expect(["me", "partner", "joint"].map(toOwnerSlot)).toEqual(["me", "partner", "joint"]);
  expect(toOwnerSlot(null)).toBe("me");
  expect(toOwnerSlot("zz")).toBe("partner");
});
