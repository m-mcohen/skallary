// src/domain/goal-cost.ts -- the budget entries a started goal cost writes.
// Pure: the server
// applies the result in one transaction.
//
// Since migration 0032 a started cost is a goal
// change: the cost is added on top of the line from the start month on
// (budget-changes.ts expandChanges), so earlier months never move and nothing
// is frozen. A new line also gets an every-month row of $0 so it exists. Go
// back to suggested never clears a goal change. A month with its own one-month
// entry keeps that entry.
import { isIncomeCategory } from "./dedup";
import { isInvestmentIncomeCategory, isSavingCategory } from "./savings";
import type { BudgetLine } from "./plan-types";

export type CostLineMode = "new" | "existing";
export interface StartCostRequest { planId: string; line: string; mode: CostLineMode }

/** The same line for our purposes: capitals and spacing do not make a new line. */
function sameName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Whether a budget line can carry a goal's cost. Income names would lengthen the
 * runway instead of shortening it, and saving names (Investing, Retirement) and
 * investment income count nowhere in the budget.
 */
export function canTakeGoalCost(name: string): boolean {
  return !isIncomeCategory(name) && !isSavingCategory(name) && !isInvestmentIncomeCategory(name);
}

export function costLinesToWrite(input: {
  lines: BudgetLine[];
  planId: string;
  planStartDate: string;
  planEndDate: string;
  line: string;
  mode: CostLineMode;
  monthlyCents: number;
  startPeriod: string;
}): { write: BudgetLine[]; goalChange: { line: string; fromMonth: string; deltaCents: number }; line: string } | { error: string } {
  const line = input.line.trim();
  if (!line) return { error: "Name the budget line." };
  // The app reads any line named like income as income (dedup.ts), so a cost
  // there would lengthen the runway instead of shortening it.
  if (isIncomeCategory(line)) return { error: "A goal's cost cannot go on an income line. Choose another name or line." };
  if (!canTakeGoalCost(line)) return { error: "A goal's cost cannot go on a saving line such as Investing or Retirement. Choose another name or line." };
  // Capitals and spacing do not make a different line; the line's own name is used from here on.
  // The exact name wins (older versions allowed "Fitness" and "fitness" side by side, and each must stay
  // reachable); failing that, one line that differs only in capitals or spacing; two of those is ambiguous.
  const wanted = sameName(line);
  const names = [...new Set(input.lines.map((l) => l.planningCategory))];
  const similar = names.filter((n) => sameName(n) === wanted);
  if (!names.includes(line) && similar.length > 1 && input.mode === "existing") {
    return { error: `There is more than one budget line named like ${line} (${similar.join(", ")}). Pick one by its exact name.` };
  }
  const name = names.includes(line) ? line : similar[0] ?? line;
  const mine = input.lines.filter((l) => l.planningCategory === name);
  const exists = mine.length > 0;
  if (input.mode === "new" && exists) {
    return { error: `There is already a budget line called ${name}. Pick it under Add to an existing line, or choose another name.` };
  }
  if (input.mode === "existing" && !exists) return { error: `There is no budget line called ${line}.` };

  // Since 0032 a goal's cost is a goal change: added on top of the line from the start
  // month on, never touching earlier months and never cleared by Go back to suggested.
  // A new line gets an every-month row of $0 so it exists.
  const write: BudgetLine[] = exists ? [] : [{ planId: input.planId, planningCategory: name, period: null, amountCents: 0 }];
  return { write, goalChange: { line: name, fromMonth: input.startPeriod, deltaCents: input.monthlyCents }, line: name };
}
