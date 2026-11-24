import { expect, test } from "vitest";
import { isIncludedForCalc, withEffectiveInclude } from "../../src/domain/account-filter";
import type { Account } from "../../src/domain/types";

const acct = (o: Partial<Account>): Account => ({
  id: "a1", name: "Test", type: "checking", institution: null, currency: "USD",
  isOwned: true, includeInSpend: true, owner: "me", ...o,
});

test("isIncludedForCalc: partner-owned account excluded when includePartner=false, included when true", () => {
  const partner = acct({ owner: "partner" });
  expect(isIncludedForCalc(partner, false)).toBe(false);
  expect(isIncludedForCalc(partner, true)).toBe(true);
});

test("isIncludedForCalc: joint and me accounts always included regardless of includePartner", () => {
  const joint = acct({ owner: "joint" });
  const me = acct({ owner: "me" });
  expect(isIncludedForCalc(joint, false)).toBe(true);
  expect(isIncludedForCalc(joint, true)).toBe(true);
  expect(isIncludedForCalc(me, false)).toBe(true);
  expect(isIncludedForCalc(me, true)).toBe(true);
});

test("isIncludedForCalc: includeInSpend=false stays excluded regardless of owner or includePartner", () => {
  const meExcluded = acct({ owner: "me", includeInSpend: false });
  const jointExcluded = acct({ owner: "joint", includeInSpend: false });
  const partnerExcluded = acct({ owner: "partner", includeInSpend: false });
  expect(isIncludedForCalc(meExcluded, true)).toBe(false);
  expect(isIncludedForCalc(jointExcluded, true)).toBe(false);
  expect(isIncludedForCalc(partnerExcluded, true)).toBe(false);
});

test("withEffectiveInclude rewrites includeInSpend per isIncludedForCalc, leaving other fields untouched", () => {
  const accounts: Account[] = [
    acct({ id: "me1", owner: "me" }),
    acct({ id: "p1", owner: "partner" }),
    acct({ id: "joint1", owner: "joint" }),
    acct({ id: "p-excluded", owner: "partner", includeInSpend: false }),
  ];

  const withPartnerExcluded = withEffectiveInclude(accounts, false);
  expect(withPartnerExcluded.find((a) => a.id === "me1")!.includeInSpend).toBe(true);
  expect(withPartnerExcluded.find((a) => a.id === "p1")!.includeInSpend).toBe(false);
  expect(withPartnerExcluded.find((a) => a.id === "joint1")!.includeInSpend).toBe(true);
  expect(withPartnerExcluded.find((a) => a.id === "p-excluded")!.includeInSpend).toBe(false);

  const withPartnerIncluded = withEffectiveInclude(accounts, true);
  expect(withPartnerIncluded.find((a) => a.id === "me1")!.includeInSpend).toBe(true);
  expect(withPartnerIncluded.find((a) => a.id === "p1")!.includeInSpend).toBe(true);
  expect(withPartnerIncluded.find((a) => a.id === "joint1")!.includeInSpend).toBe(true);
  expect(withPartnerIncluded.find((a) => a.id === "p-excluded")!.includeInSpend).toBe(false);

  // owner/id/other fields untouched
  expect(withPartnerIncluded.find((a) => a.id === "p1")!.owner).toBe("partner");
});
