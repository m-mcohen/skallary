// src/domain/budget-colors.ts -- when a difference on the Budget is real, and which way
// it reads.
// A difference is real when it is larger than the greater of $25 or 10% of the line.
// Spending up or income down is red; spending down or income up is blue; anything else
// is grey. Pure: no clock, no I/O.
export type Tone = "red" | "blue" | "grey";
export type LineSide = "spending" | "income";

export function realThreshold(baseCents: number): number {
  return Math.max(2500, Math.round(Math.abs(baseCents) / 10));
}

export function isReal(diffCents: number, baseCents: number): boolean {
  return Math.abs(diffCents) > realThreshold(baseCents);
}

function direction(side: LineSide, diffCents: number): Tone {
  const up = diffCents > 0;
  if (side === "spending") return up ? "red" : "blue";
  return up ? "blue" : "red";
}

/** The Change column and bar, against the comparison figure. A variable line with nothing spent stays grey. */
export function changeTone(side: LineSide, actualCents: number, comparisonCents: number | null, fixed = false): Tone {
  if (comparisonCents === null) return "grey";
  const diff = actualCents - comparisonCents;
  if (!isReal(diff, comparisonCents)) return "grey";
  if (side === "spending" && actualCents === 0 && !fixed) return "grey";
  return direction(side, diff);
}

/** The budget bar: red only when spending is over budget by a real amount; otherwise neutral. */
export function budgetBarTone(side: LineSide, actualCents: number, budgetCents: number | null): Tone {
  if (side !== "spending" || budgetCents === null) return "grey";
  return actualCents - budgetCents > realThreshold(budgetCents) ? "red" : "grey";
}

/**
 * The Left column (budget minus spent). Spending over budget reads red at once, and income
 * ahead of budget blue at once; spending under budget reads blue, and income short red,
 * only once the month is finished, since mid-month every line is still under.
 */
export function leftTone(side: LineSide, budgetCents: number | null, actualCents: number, finished: boolean): Tone {
  if (budgetCents === null) return "grey";
  const diff = actualCents - budgetCents;
  if (!isReal(diff, budgetCents)) return "grey";
  const tone = direction(side, diff);
  if (finished) return tone;
  if (side === "spending") return tone === "red" ? "red" : "grey";
  return tone === "blue" ? "blue" : "grey";
}

/** Where the month in progress is heading at its pace so far. */
export function headingFor(spentCents: number, dayOfMonth: number, daysInMonth: number): number {
  return Math.round((spentCents / dayOfMonth) * daysInMonth);
}

/** "Heading over": the pace beats the budget by a real amount. The caller limits it to variable lines this month. */
export function isHeadingOver(spentCents: number, budgetCents: number | null, dayOfMonth: number, daysInMonth: number): boolean {
  // Nothing spent is never heading over (a line budgeted below zero, a
  // refund line, would otherwise read as heading over with $0 spent).
  if (budgetCents === null || dayOfMonth <= 0 || spentCents <= 0) return false;
  return headingFor(spentCents, dayOfMonth, daysInMonth) - budgetCents > realThreshold(budgetCents);
}

/** The budget bar: fill = spent, tick = budget, both as a share of the larger. A refund draws no fill. */
export function budgetBarGeometry(actualCents: number, budgetCents: number | null): { fillPct: number; tickPct: number | null } {
  const spent = Math.max(0, actualCents);
  const budget = budgetCents === null ? null : Math.max(0, budgetCents);
  const scale = Math.max(spent, budget ?? 0);
  if (scale === 0) return { fillPct: 0, tickPct: budget === null ? null : 0 };
  return { fillPct: (spent / scale) * 100, tickPct: budget === null ? null : (budget / scale) * 100 };
}

/** The change bar: centered; less grows left, more grows right, scaled so the biggest change on screen fills half. */
export function changeBarGeometry(changeCents: number | null, scaleCents: number): { side: "left" | "right"; pct: number } | null {
  if (changeCents === null || changeCents === 0 || scaleCents <= 0) return null;
  return { side: changeCents < 0 ? "left" : "right", pct: Math.min(1, Math.abs(changeCents) / scaleCents) * 50 };
}
