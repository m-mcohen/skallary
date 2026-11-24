import { expect, test } from "vitest";
import { parseDollarsToCents, formatCents, formatWholeDollars, formatAxisDollars, sumCents } from "../../src/domain/money";

test("parseDollarsToCents handles commas and decimals", () => {
  expect(parseDollarsToCents("1,234.56")).toBe(123456);
  expect(parseDollarsToCents("$0.09")).toBe(9);
  expect(parseDollarsToCents("-5")).toBe(-500);
});
test("parseDollarsToCents rejects garbage", () => {
  expect(() => parseDollarsToCents("abc")).toThrow();
});
test("formatCents renders sign and separators", () => {
  expect(formatCents(123456)).toBe("$1,234.56");
  expect(formatCents(-500)).toBe("-$5.00");
});
test("sumCents adds integers exactly", () => {
  expect(sumCents([100, 250, -50])).toBe(300);
});
test("formatWholeDollars rounds to the nearest dollar with separators and a leading minus", () => {
  expect(formatWholeDollars(125_075)).toBe("$1,251");
  expect(formatWholeDollars(19_050_050)).toBe("$190,501");
  expect(formatWholeDollars(-50_000)).toBe("-$500");
});

// Axis labels: short, sign first, no cents. A below-zero label once read "$50,000.00"
// when the axis clipped its minus sign.
test.each([
  [0, "$0"],
  [-40, "$0"],
  [99_900, "$999"],
  [-100_000, "-$1K"],
  [750_000, "$7.5K"],
  [-5_000_000, "-$50K"],
  [125_000_000, "$1.3M"],
])("formatAxisDollars(%i) is %s", (cents, text) => {
  expect(formatAxisDollars(cents)).toBe(text);
});
