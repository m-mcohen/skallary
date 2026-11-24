import { describe, it, expect } from "vitest";
import { parseAmountToCents } from "../../src/domain/simplefin";

describe("parseAmountToCents", () => {
  it("parses the two-decimal amounts SimpleFIN sends for transactions", () => {
    expect(parseAmountToCents("-33293.43")).toBe(-3329343);
    expect(parseAmountToCents("115245.51")).toBe(11524551);
    expect(parseAmountToCents("0.00")).toBe(0);
  });

  it("parses fewer than two decimals -- the Bridge trims trailing zeros on holdings", () => {
    // Observed live: market_value "105884.8" and purchase_price "0.10".
    expect(parseAmountToCents("105884.8")).toBe(10588480);
    expect(parseAmountToCents("0.10")).toBe(10);
    expect(parseAmountToCents("42")).toBe(4200);
  });

  it("rounds more than two decimals to the nearest cent, away from zero on a tie", () => {
    // The protocol says "numeric string" -- it does not promise 2dp, and
    // investment cost bases routinely carry more precision.
    expect(parseAmountToCents("1.005")).toBe(101);
    expect(parseAmountToCents("-1.005")).toBe(-101);
    expect(parseAmountToCents("1.004")).toBe(100);
    expect(parseAmountToCents("1.006")).toBe(101);
  });

  it("never loses a cent to float error on large values", () => {
    // 8103.29 * 100 is 810328.9999... in IEEE754; a parseFloat-based parser
    // truncates this to 810328.
    expect(parseAmountToCents("8103.29")).toBe(810329);
    expect(parseAmountToCents("1234567.89")).toBe(123456789);
  });

  it("accepts an explicit + sign and surrounding whitespace", () => {
    expect(parseAmountToCents("+12.34")).toBe(1234);
    expect(parseAmountToCents("  -5.00  ")).toBe(-500);
  });

  it("rejects anything that isn't a number rather than silently returning 0", () => {
    expect(() => parseAmountToCents("")).toThrow(/not a numeric amount/i);
    expect(() => parseAmountToCents("abc")).toThrow(/not a numeric amount/i);
    expect(() => parseAmountToCents("1.2.3")).toThrow(/not a numeric amount/i);
    // A dollar sign means we were handed display text, not API data.
    expect(() => parseAmountToCents("$1.00")).toThrow(/not a numeric amount/i);
  });
});
