import { describe, expect, it } from "vitest";
import { DEMO, buildDemo } from "../../demo/household.js";

/** The invented account tails. Written out here, not imported, so a changed tail fails. */
const INVENTED_TAILS = ["0101", "0202", "0303", "0404", "0505", "0606", "0707"];

describe("the demo household", () => {
  it("is the same every time it is built", () => {
    expect(buildDemo()).toEqual(buildDemo());
  });

  it("has only whole-dollar or 50-cent transaction amounts", () => {
    expect(DEMO.transactions.length).toBeGreaterThan(0);
    expect(DEMO.transactions.filter((t) => t.amountCents % 50 !== 0)).toEqual([]);
  });

  it("uses only the invented account tails", () => {
    for (const a of DEMO.accounts) {
      expect(INVENTED_TAILS).toContain(a.tail);
      for (const digits of a.account.name.match(/\d{4}/g) ?? []) expect(INVENTED_TAILS).toContain(digits);
    }
  });

  it("names its charity pot Charity", () => {
    expect(DEMO.pot.name).toBe("Charity");
  });
});
