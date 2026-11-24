// src/domain/budget-changes.ts -- the user's budget changes as the rest of the app reads them.
// A change stays in its own table; when the budget
// is handed out, each month a change covers becomes an ordinary one-month row marked
// origin "change", so every reader of resolveMonthlyPlan sees the amount in force with
// no change of its own. A real one-month row (old data, a goal freeze from before 0032)
// still wins for its month.
import { addMonths } from "./scenario";
import type { BudgetChange, BudgetLine } from "./plan-types";
import type { YearlyShare } from "./yearly-costs";

function subtractShares<T extends Pick<BudgetLine, "planId" | "planningCategory" | "amountCents">>(row: T, shares: YearlyShare[]): T {
  let cents = 0;
  for (const share of shares) {
    if (share.planId === row.planId && share.planningCategory === row.planningCategory) cents += share.cents;
  }
  return cents === 0 ? row : { ...row, amountCents: row.amountCents - cents };
}

export function applyYearlyShares(rows: BudgetLine[], shares: YearlyShare[]): BudgetLine[] {
  return shares.length ? rows.map(row => subtractShares(row, shares)) : rows;
}

export function applyYearlySharesToChanges(changes: BudgetChange[], shares: YearlyShare[]): BudgetChange[] {
  return shares.length ? changes.map(row => row.reason === "changed" ? subtractShares(row, shares) : row) : changes;
}

export function lineChangesIn(changes: BudgetChange[], line: string): { changed: BudgetChange[]; goals: BudgetChange[] } {
  const mine = changes.filter((c) => c.planningCategory === line).sort((a, b) => a.fromMonth.localeCompare(b.fromMonth) || a.id - b.id);
  return { changed: mine.filter((c) => c.reason === "changed"), goals: mine.filter((c) => c.reason === "goal") };
}

/** The lines plus one row per month each changed line covers, from its first change through `throughMonth`. */
export function expandChanges(lines: BudgetLine[], changes: BudgetChange[], throughMonth: string): BudgetLine[] {
  if (changes.length === 0) return lines;
  const out = [...lines];
  for (const cat of [...new Set(changes.map((c) => c.planningCategory))]) {
    const { changed, goals } = lineChangesIn(changes, cat);
    const all = [...changed, ...goals];
    const planId = all[0].planId;
    const usual = lines.find((l) => l.planningCategory === cat && l.period === null)?.amountCents ?? 0;
    const ownMonths = new Set(lines.filter((l) => l.planningCategory === cat && l.period !== null).map((l) => l.period as string));
    const first = all.map((c) => c.fromMonth).sort()[0];
    for (let m = first; m <= throughMonth; m = addMonths(m, 1)) {
      if (ownMonths.has(m)) continue;
      const set = changed.filter((c) => c.fromMonth <= m).pop();
      const base = set ? set.amountCents : usual;
      const extra = goals.filter((c) => c.fromMonth <= m).reduce((sum, c) => sum + c.amountCents, 0);
      out.push({ planId, planningCategory: cat, period: m, amountCents: base + extra, origin: "change" });
    }
  }
  return out;
}
