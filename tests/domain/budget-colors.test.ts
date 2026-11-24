import { describe, expect, test } from "vitest";
import {
  budgetBarGeometry, budgetBarTone, changeBarGeometry, changeTone, headingFor, isHeadingOver, isReal, leftTone, realThreshold,
} from "../../src/domain/budget-colors";

describe("the $25 or 10% rule", () => {
  test("the larger of $25 or 10% of the line, and strictly larger counts", () => {
    expect(realThreshold(10000)).toBe(2500);
    expect(realThreshold(30000)).toBe(3000);
    expect(realThreshold(-30000)).toBe(3000);
    expect(isReal(3000, 30000)).toBe(false);
    expect(isReal(3001, 30000)).toBe(true);
    expect(isReal(-3001, 30000)).toBe(true);
  });
});

describe("Change", () => {
  test("spending up is red, down is blue, small is grey", () => {
    expect(changeTone("spending", 60000, 50000)).toBe("red");
    expect(changeTone("spending", 40000, 50000)).toBe("blue");
    expect(changeTone("spending", 52000, 50000)).toBe("grey");
  });
  test("income up is blue, down is red", () => {
    expect(changeTone("income", 600000, 500000)).toBe("blue");
    expect(changeTone("income", 400000, 500000)).toBe("red");
  });
  test("a variable line with nothing spent stays grey; a fixed one does not", () => {
    expect(changeTone("spending", 0, 50000)).toBe("grey");
    expect(changeTone("spending", 0, 50000, true)).toBe("blue");
  });
  test("no comparison is grey", () => {
    expect(changeTone("spending", 50000, null)).toBe("grey");
  });
});

describe("the budget bar and Left", () => {
  test("the bar is red only when spending beats the budget by a real amount", () => {
    expect(budgetBarTone("spending", 50000, 45000)).toBe("red");
    expect(budgetBarTone("spending", 47000, 45000)).toBe("grey");
    expect(budgetBarTone("spending", 10000, 45000)).toBe("grey");
    expect(budgetBarTone("income", 0, 45000)).toBe("grey");
    expect(budgetBarTone("spending", 50000, null)).toBe("grey");
  });
  test("Left: over is red at once; under is blue only when the month is finished", () => {
    expect(leftTone("spending", 45000, 50000, false)).toBe("red");
    expect(leftTone("spending", 45000, 10000, false)).toBe("grey");
    expect(leftTone("spending", 45000, 10000, true)).toBe("blue");
    expect(leftTone("income", 500000, 400000, false)).toBe("grey");
    expect(leftTone("income", 500000, 400000, true)).toBe("red");
    expect(leftTone("income", 500000, 600000, false)).toBe("blue");
    expect(leftTone("spending", null, 50000, true)).toBe("grey");
  });
});

describe("heading over", () => {
  test("pace = spent so far / days passed x days in the month", () => {
    expect(headingFor(20000, 10, 31)).toBe(62000);
    expect(isHeadingOver(20000, 50000, 10, 31)).toBe(true); // 62,000 - 50,000 > 5,000
    expect(isHeadingOver(20000, 58000, 10, 31)).toBe(false); // 4,000 is within 5,800
    expect(isHeadingOver(20000, null, 10, 31)).toBe(false);
  });
  test("nothing spent is never heading over, even on a line budgeted below zero", () => {
    expect(isHeadingOver(0, -4000, 6, 31)).toBe(false);
    expect(isHeadingOver(0, 50000, 6, 31)).toBe(false);
  });
});

describe("bar geometry", () => {
  test("the budget bar scales to the larger of spent and budget; a refund draws no fill", () => {
    expect(budgetBarGeometry(50000, 100000)).toEqual({ fillPct: 50, tickPct: 100 });
    expect(budgetBarGeometry(100000, 50000)).toEqual({ fillPct: 100, tickPct: 50 });
    expect(budgetBarGeometry(-5000, 50000)).toEqual({ fillPct: 0, tickPct: 100 });
    expect(budgetBarGeometry(5000, null)).toEqual({ fillPct: 100, tickPct: null });
    expect(budgetBarGeometry(0, 0)).toEqual({ fillPct: 0, tickPct: 0 });
  });
  test("the change bar grows left for less and right for more, half the width at most", () => {
    expect(changeBarGeometry(-5000, 10000)).toEqual({ side: "left", pct: 25 });
    expect(changeBarGeometry(20000, 10000)).toEqual({ side: "right", pct: 50 });
    expect(changeBarGeometry(0, 10000)).toBeNull();
    expect(changeBarGeometry(null, 10000)).toBeNull();
  });
});
