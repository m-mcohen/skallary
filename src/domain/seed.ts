// src/domain/seed.ts
//
// Pure averaging helper: seeds category budget defaults from trailing
// actuals. Expense categories only -- income is never auto-seeded (see
// Global Constraints: income default stays $0, modeled via a start-month
// ramp instead). Looks at the most recent `windowMonths` COMPLETE months
// strictly before `asOfMonth` (the caller passes asOfMonth = the month
// AFTER the latest actual month, so a partial current month is excluded).
//
// RECURRENCE-AWARE averaging: dividing every category's total
// by the full window undercounts a monthly bill that didn't post every
// month (e.g. rent that landed on an excluded account some months, or just
// timing), while dividing by the months it actually occurred overcounts a
// once-a-year charge (it would be seeded as if it were monthly). So a
// category that appears in a MAJORITY of the window's months is treated as
// recurring -- averaged over the months it occurred (rent -> its true
// monthly amount) -- and an occasional category keeps dividing by the full
// window (a once-a-year charge stays a small monthly-equivalent). The user
// still tweaks any line; this just makes the starting draft honest.
import type { MonthlyRollup } from "./rollups";

export function priorMonths(asOfMonth: string, n: number): string[] {
  let [y, m] = asOfMonth.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    m--;
    if (m < 1) {
      m = 12;
      y--;
    }
    out.unshift(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out; // the n complete months strictly before asOfMonth
}

export function seedExpenseDefaults(
  rollups: MonthlyRollup[],
  asOfMonth: string,
  windowMonths: number
): { window: string[]; defaults: { planningCategory: string; amountCents: number; recurring: boolean }[] } {
  const window = priorMonths(asOfMonth, windowMonths);
  const inWindow = new Set(window);
  const sums = new Map<string, number>();
  const activeMonths = new Map<string, Set<string>>(); // category -> window months it actually had spend
  for (const rr of rollups) {
    if (rr.kind !== "expense") continue; // income never auto-seeded
    if (!inWindow.has(rr.period)) continue;
    sums.set(rr.planningCategory, (sums.get(rr.planningCategory) ?? 0) + rr.amountCents);
    if (rr.amountCents !== 0) {
      const set = activeMonths.get(rr.planningCategory) ?? new Set<string>();
      set.add(rr.period);
      activeMonths.set(rr.planningCategory, set);
    }
  }
  // A category is "recurring" when it appears in a strict majority of the window's months.
  // This is the same test used to pick the averaging divisor below, so `recurring` is
  // exposed here as a first-class per-category flag (not re-derived downstream).
  const recurringThreshold = windowMonths / 2;
  const defaults = [...sums.entries()]
    .map(([planningCategory, total]) => {
      const active = activeMonths.get(planningCategory)?.size ?? 0;
      const recurring = active > recurringThreshold;
      const divisor = recurring ? active : windowMonths;
      return { planningCategory, amountCents: Math.round(total / divisor), recurring };
    })
    .sort((a, b) => a.planningCategory.localeCompare(b.planningCategory));
  return { window, defaults };
}

/**
 * The month the seed window ends BEFORE.
 *
 * Normally the month after the latest actual, so the latest full month of data
 * is included. But the current calendar month is still in progress: after the
 * SimpleFIN cutover the database contains transactions dated today, and
 * treating that month as complete averages a day or two of spending in as
 * though it were a whole month, quietly deflating every recurring category by
 * roughly a twelfth. So the window never runs past the start of the current
 * month.
 */
function nextMonth(period: string): string {
  let [y, m] = period.split("-").map(Number);
  m++;
  if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function seedAsOfMonth(latestActualMonth: string, currentMonth: string): string {
  const afterLatest = nextMonth(latestActualMonth);
  return afterLatest < currentMonth ? afterLatest : currentMonth;
}
