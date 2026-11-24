import { describe, it, test, expect } from "vitest";
import { TAX_2026_MFJ, federalIncomeTaxCents } from "../../src/domain/tax";
import { netFromGrossW2Cents } from "../../src/domain/tiers";

// The take-home cases below use round gross figures; their nets are recomputed from the 2026
// constants and checked by hand for the $200,000 case (see the W2 net test above).

describe("TAX_2026_MFJ", () => {
  test("carries the real 2026 figures (IRS Rev. Proc. 2025-32; SSA)", () => {
    expect(TAX_2026_MFJ.stdDeductionCents).toBe(3_220_000);
    expect(TAX_2026_MFJ.ctcCents).toBe(220_000);
    expect(TAX_2026_MFJ.ssWageBaseCents).toBe(18_450_000);
    expect(TAX_2026_MFJ.addlMedicareThresholdCents).toBe(25_000_000);
    expect(TAX_2026_MFJ.addlMedicareRate).toBe(0.009);
    expect(TAX_2026_MFJ.qbiFullTaxableCents).toBe(40_350_000);
    expect(TAX_2026_MFJ.qbiZeroTaxableCents).toBe(55_350_000);
    expect(TAX_2026_MFJ.brackets).toEqual([
      { uptoCents: 2_480_000, rate: 0.10 },
      { uptoCents: 10_080_000, rate: 0.12 },
      { uptoCents: 21_140_000, rate: 0.22 },
      { uptoCents: 40_355_000, rate: 0.24 },
      { uptoCents: 51_245_000, rate: 0.32 },
      { uptoCents: 76_870_000, rate: 0.35 },
      { uptoCents: Infinity, rate: 0.37 },
    ]);
  });

  test("federal tax on $200,000 taxable: 10% of 24,800 + 12% of 76,000 + 22% of 99,200", () => {
    expect(federalIncomeTaxCents(20_000_000)).toBe(3_342_400);
  });

  test("W2 net on $200,000 gross, one child, includes no additional Medicare below $250,000", () => {
    // FICA 7.65% of 184,500 + 1.45% of 15,500 = 14,339.00; taxable 167,800 -> fed 26,340 - 2,200
    expect(netFromGrossW2Cents(20_000_000)).toBe(16_152_100);
  });

  test("W2 net above $250,000 pays 0.9% additional Medicare on the excess", () => {
    const at250 = netFromGrossW2Cents(25_000_000);
    const at260 = netFromGrossW2Cents(26_000_000);
    // $10,000 more gross above the threshold: Medicare 1.45% + 0.9% = $235,
    // and taxable income (217,800 -> 227,800) stays inside the 24% band = $2,400.
    expect(at260 - at250).toBe(1_000_000 - 23_500 - 240_000);
  });

  test("two children double the credit", () => {
    expect(netFromGrossW2Cents(20_000_000, TAX_2026_MFJ, 2) - netFromGrossW2Cents(20_000_000)).toBe(220_000);
  });
});

describe("federalIncomeTaxCents", () => {
  it("matches fed() at each bracket boundary and interior points", () => {
    // Recomputed for the real 2026 brackets.
    const cases: [number, number][] = [
      [0, 0],
      [2_480_000, 248_000],
      [10_080_000, 1_160_000],
      [21_140_000, 3_593_200],
      [40_355_000, 8_204_800],
      [51_245_000, 11_689_600],
      [76_870_000, 20_658_350],
      [10_000_000, 1_150_400],
      [30_000_000, 5_719_600],
    ];
    for (const [taxableCents, expectedCents] of cases) {
      expect(federalIncomeTaxCents(taxableCents)).toBe(expectedCents);
    }
  });

  it("clamps negative taxable income to zero tax", () => {
    expect(federalIncomeTaxCents(-500_000)).toBe(0);
  });
});

const TOLERANCE_CENTS = 100; // +/- $1

describe("netFromGrossW2Cents (recomputed for 2026 figures)", () => {
  // Round gross figures; net recomputed under the real 2026 tax constants.
  const cases: [number, number][] = [
    [100_000_00, 8_691_000],
    [150_000_00, 12_538_500],
    [200_000_00, 16_152_100],
    [400_000_00, 31_014_300],
  ];
  for (const [grossCents, expectedCents] of cases) {
    it(`matches net_w2(${grossCents / 100}) within +/-$1`, () => {
      expect(Math.abs(netFromGrossW2Cents(grossCents) - expectedCents)).toBeLessThanOrEqual(
        TOLERANCE_CENTS,
      );
    });
  }
});
