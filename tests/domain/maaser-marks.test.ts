// tests/domain/maaser-marks.test.ts -- the two per-row charity marks: invented figures.
import { describe, expect, test } from "vitest";
import { cleanMaaserMark, countedIncomeCents, marksById, type MaaserMark } from "../../src/domain/maaser-marks";

describe("cleanMaaserMark", () => {
  test("a not-counted mark, trimmed id, no amount", () => {
    expect(cleanMaaserMark(" t1 ", { kind: "not_maaser" })).toEqual({ sourceTransactionId: "t1", kind: "not_maaser", countedCents: null });
  });
  test("an income mark: none, or the part that counts", () => {
    expect(cleanMaaserMark("t2", { kind: "income" })).toEqual({ sourceTransactionId: "t2", kind: "income", countedCents: null });
    expect(cleanMaaserMark("t2", { kind: "income", countedCents: 160000 })).toEqual({ sourceTransactionId: "t2", kind: "income", countedCents: 160000 });
  });
  test("refusals are plain words", () => {
    expect(cleanMaaserMark("", { kind: "income" })).toBe("Unknown transaction.");
    expect(cleanMaaserMark("t3", null)).toBe("Unknown mark.");
    expect(cleanMaaserMark("t3", { kind: "gift" })).toBe("A mark is either not maaser or income for maaser.");
    expect(cleanMaaserMark("t3", { kind: "not_maaser", countedCents: 500 })).toBe("Only an income mark can count part of the amount.");
    for (const bad of [0, -1, 12.5, "1600"]) expect(cleanMaaserMark("t3", { kind: "income", countedCents: bad })).toBe("The part that counts is whole dollars and cents, above zero.");
  });
});

describe("countedIncomeCents", () => {
  test("the $2,000 check counts as $1,600; none counts as zero; a not-counted mark leaves income alone", () => {
    const income = (countedCents: number | null): MaaserMark => ({ sourceTransactionId: "t", kind: "income", countedCents, updatedAt: "" });
    expect(countedIncomeCents(200000, income(160000))).toBe(160000);
    expect(countedIncomeCents(200000, income(null))).toBe(0);
    expect(countedIncomeCents(200000, undefined)).toBe(200000);
    expect(countedIncomeCents(200000, { ...income(null), kind: "not_maaser" })).toBe(200000);
  });
});

describe("marksById", () => {
  test("keys marks by transaction id", () => {
    const m: MaaserMark = { sourceTransactionId: "t9", kind: "not_maaser", countedCents: null, updatedAt: "" };
    expect(marksById([m]).get("t9")).toBe(m);
  });
});

describe("a part mark keeps the row's sign", () => {
  test("a negative correction marked part counts as a negative part, never a positive one", () => {
    const part = (c: number | null): MaaserMark => ({ sourceTransactionId: "t", kind: "income", countedCents: c, updatedAt: "" });
    expect(countedIncomeCents(-10000, part(5000))).toBe(-5000);
    expect(countedIncomeCents(10000, part(5000))).toBe(5000);
    expect(countedIncomeCents(-10000, part(null))).toBe(0);
  });
});
