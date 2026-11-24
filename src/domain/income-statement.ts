// src/domain/income-statement.ts
//
// A salary as an income statement, in the order
// laid out as:
//
//   Gross pay
//   (Additional salary, gross)                  when a W-2 additional salary is set
//   Federal income tax              (estimated, or from Settings)
//   Social Security and Medicare    (estimated, or from Settings)
//   State and local taxes           (from Settings), only when typed from a pay stub
//   Benefits                        (estimated, or from Settings), each one the user lists under it
//   (Additional monthly amount)                 lands in the bank as it is
//   The charity pot (its name)                  or the Charity line, when it is more
//   = Take-home                                 the only take-home: after the pot
//   Expenses                                    the budget's lines, the Charity line
//                                               left out (the pot line covers it)
//   What-if rows switched on                    each cost row; on the second total,
//                                               each goal saving too
//   Expenses (and what-if rows), in all         what Take-home has to cover
//   = Left over, or = Short
//
// Take-home comes after the pot: gross pay, less taxes, benefits and the pot, then
// take-home, then the expenses (grouped) and the what-if rows. There is no in-between
// "Take-home pay" line before the pot. One function serves the What if
// ladder's two totals and the top bar's take-home panel, so the two cannot disagree.
// Only the lines the math computes. State and local income tax is not estimated: its
// line shows only when typed from a pay stub, and a note says so otherwise.
//
// Built twice, Yearly and Monthly, and each adds up to the cent:
// - Yearly lines are the breakdown's own rounded figures. Social Security and
//   Medicare is gross less federal tax less pay after tax, so the running total is exact.
// - Monthly lines round each running total of the pay lines once (the year's running
//   total divided by 12), so the paycheck is exactly monthlyPayCents' (the one rounding
//   path Runway and Check a salary use); the pot a month is that path's pot month, or the
//   Charity line when it is larger.
// - Expense and what-if lines are a month's amount, and 12 times it a year.
// Pure; integer cents. Money out is negative.
import { monthlyPayCents, type SalaryAssumptions, type SalaryBreakdown } from "./salary";
import { potAnnualModelCents, potIsOn, potLabel } from "./charity-pot";
import { benefitMonthlyCents } from "./benefits";

/** The budget line the pot stands in for; it is left out of Expenses. */
const CHARITY = "Charity";

export interface StatementLine {
  /**
   * "gross", "other-gross", "federal", "payroll", "other-taxes", "premium", "other-net", "maaser",
   * "take-home", "expenses" (heading), "expense:<budget line>", "what-if" (heading),
   * "row:<row id>", "in-all", "left-over".
   */
  id: string;
  label: string;
  /** Signed: money in positive, money out negative. 0 on a heading. */
  cents: number;
  /** An "=" line: the running sum of every line above it that is not a heading or "in all". */
  total: boolean;
  /** A heading over a group of lines: no figure. */
  heading?: boolean;
  /** "In all": the sum of the expense and what-if lines, outside the running sum. */
  subtotal?: boolean;
  /** For the tax and premium lines: where the figure comes from. */
  source?: "estimated" | "settings";
  /**
   * On the Benefits line, when the user lists the user's benefits: each one, money
   * out with a minus. Beside the running sum, never in it: the line itself carries the total.
   */
  items?: { label: string; cents: number }[];
}

export interface IncomeStatement {
  yearly: StatementLine[];
  monthly: StatementLine[];
  /** Short notes in plain words: the joint tax, a typed monthly amount, the Charity line. */
  notes: string[];
}

export type StatementView = "monthly" | "yearly";

/** One line of the budget, or one what-if row: what it costs a month (a cut is negative). */
export interface StatementCost {
  label: string;
  cents: number;
}

export interface StatementRow extends StatementCost {
  id: string;
}

export interface StatementInput {
  /** The salary's figures, as salaryForView, w2Breakdown or currentSalaryBreakdown priced them. */
  breakdown: SalaryBreakdown;
  /** Settings, Salary as the salary was priced under (the maaser rate; whether the premium was typed). */
  assumptions: SalaryAssumptions;
  /** The budget's Charity line a month: charity is the larger of it and maaser. */
  charityLineMonthlyCents: number;
  /** The budget's lines a month, in the Budget's order. The Charity line, if passed, is left out. */
  expenses: StatementCost[];
  /** The what-if rows switched on, a month each, in the list's order. */
  rows?: StatementRow[];
}

/** The cents of one line, 0 when the statement has no such line. */
export function statementCents(lines: StatementLine[], id: string): number {
  return lines.find((l) => l.id === id)?.cents ?? 0;
}

/** A shortfall worth calling one: short by a dollar a month or more. A few cents either way is the salary's rounding to the dollar. */
export function isShort(s: IncomeStatement): boolean {
  return statementCents(s.monthly, "left-over") <= -100;
}

const SOURCE_WORDS = { estimated: "estimated", settings: "from Settings" } as const;

type Upper = { id: string; label: string; cents: number; source?: "estimated" | "settings" };

export function incomeStatement(input: StatementInput): IncomeStatement {
  const b = input.breakdown;
  const a = input.assumptions;
  const otherGross = b.otherGrossAnnualCents ?? 0;
  const otherNet = b.otherNetAnnualCents ?? 0;
  const joint = otherGross > 0;
  const rows = input.rows ?? [];
  const expenses = input.expenses.filter((e) => e.label !== CHARITY);
  const labelled = (label: string, source: "estimated" | "settings") => `${label} (${SOURCE_WORDS[source]})`;
  const fed: "estimated" | "settings" = b.firmFederal ? "settings" : "estimated";
  const pay: "estimated" | "settings" = b.firmPayroll ? "settings" : "estimated";
  const prem: "estimated" | "settings" = a.premiumFromSettings === false ? "estimated" : "settings";
  const otherTaxes = b.otherTaxesAnnualCents ?? 0;
  // Two salaries: one return when filing jointly, else two returns; the tax lines add both.
  const filedJointly = (a.tax?.filingStatus ?? "mfj") === "mfj";

  // The pay lines, a year: income less what comes out before the bank.
  const upper: Upper[] = [
    { id: "gross", label: "Gross pay", cents: b.grossAnnualCents },
    ...(joint ? [{ id: "other-gross", label: "Additional salary (gross)", cents: otherGross }] : []),
    { id: "federal", label: labelled(joint ? (filedJointly ? "Federal income tax, both salaries, filed jointly" : "Federal income tax, both salaries") : "Federal income tax", fed), cents: -b.federalAnnualCents, source: fed },
    // Gross less federal tax less pay after tax: the breakdown's payroll, exact to its own subtotal.
    {
      id: "payroll",
      label: labelled(joint ? "Social Security and Medicare, both salaries" : "Social Security and Medicare", pay),
      cents: -(b.grossAnnualCents + otherGross - b.federalAnnualCents - otherTaxes - b.afterTaxAnnualCents),
      source: pay,
    },
    ...(otherTaxes > 0 ? [{ id: "other-taxes", label: labelled("State and local taxes", "settings"), cents: -otherTaxes, source: "settings" as const }] : []),
    { id: "premium", label: labelled("Benefits", prem), cents: -b.premiumAnnualCents, source: prem },
    ...(otherNet > 0 ? [{ id: "other-net", label: "Additional monthly amount (no tax worked on it)", cents: otherNet }] : []),
  ];

  // Each benefit the user lists, a month; a year is 12 times it, so a year's items add up to the line
  // exactly. A month's line is a running total's rounding, so its items can be a cent off it.
  const listed = (a.benefits ?? []).map((x) => ({ label: x.beforeTax ? x.name : `${x.name} (after tax)`, monthly: benefitMonthlyCents(x, a.paySchedule ?? null) }));
  const itemsFor = (k: number) => (listed.length > 0 ? listed.map((x) => ({ label: x.label, cents: -x.monthly * k })) : undefined);
  const withItems = (l: StatementLine, k: number): StatementLine => (l.id === "premium" && listed.length > 0 ? { ...l, items: itemsFor(k) } : l);

  // A year: the lines as they stand. A month: each running total divided by 12 and rounded once.
  const yearlyUpper: StatementLine[] = upper.map((u) => withItems({ ...u, total: false }, 12));
  const paycheckYear = upper.reduce((sum, u) => sum + u.cents, 0);
  const monthlyUpper: StatementLine[] = [];
  let runYear = 0;
  let runMonth = 0;
  for (const u of upper) {
    runYear += u.cents;
    const next = Math.round(runYear / 12);
    monthlyUpper.push(withItems({ ...u, cents: next - runMonth, total: false }, 1));
    runMonth = next;
  }
  const paycheckMonth = runMonth;

  // Charity: the larger of the Charity line and maaser. The year's is the breakdown's;
  // the month's is the paycheck path's maaser (monthlyPayCents).
  const maaserMonth = monthlyPayCents(b, a).maaserCents;
  const charityMonth = Math.max(input.charityLineMonthlyCents, maaserMonth);
  const charityYear = b.charityAnnualCents;
  const lineWinsYear = input.charityLineMonthlyCents * 12 > Math.round(potAnnualModelCents(a.pot, b.afterTaxAnnualCents - b.premiumAnnualCents, a.maaserRate));
  const lineWinsMonth = input.charityLineMonthlyCents > maaserMonth;
  // The pot by the name the user gave it; with the pot off, the line is the Charity line itself.
  const potOn = a.pot === undefined || potIsOn(a.pot);
  const potName = potLabel(a.pot);
  const potWords = a.pot && a.pot.kind !== "percent" ? `${potName} (a set amount)` : `${potName} (its share of pay into the bank)`;
  const charityLabel = (lineWins: boolean) => (!potOn ? "Charity line" : lineWins ? `Charity line (it is more than ${potName})` : potWords);

  const lower = (view: StatementView, paycheck: number, charity: number, lineWins: boolean): StatementLine[] => {
    const k = view === "yearly" ? 12 : 1;
    const takeHome = paycheck - charity;
    const expenseLines: StatementLine[] = expenses.map((e) => ({ id: `expense:${e.label}`, label: e.label, cents: -e.cents * k, total: false }));
    const rowLines: StatementLine[] = rows.map((r) => ({ id: `row:${r.id}`, label: r.label, cents: -r.cents * k, total: false }));
    const inAll = [...expenseLines, ...rowLines].reduce((sum, l) => sum + l.cents, 0);
    const over = takeHome + inAll;
    return [
      { id: "maaser", label: charityLabel(lineWins), cents: -charity, total: false },
      { id: "take-home", label: "= Take-home", cents: takeHome, total: true },
      { id: "expenses", label: "Expenses", cents: 0, total: false, heading: true },
      ...expenseLines,
      ...(rowLines.length > 0 ? [{ id: "what-if", label: "What-if rows switched on", cents: 0, total: false, heading: true }, ...rowLines] : []),
      { id: "in-all", label: rowLines.length > 0 ? "Expenses and what-if rows, in all" : "Expenses, in all", cents: inAll, total: false, subtotal: true },
      { id: "left-over", label: over < 0 ? "= Short" : "= Left over", cents: over, total: true },
    ];
  };

  const notes: string[] = [];
  if (joint) notes.push(filedJointly ? "Your salary and the additional salary are taxed together, filed jointly, so the tax lines are for both salaries." : "The additional salary is taxed on its own single return; the tax lines add both returns.");
  if (otherNet > 0) notes.push(potOn ? `The additional monthly amount is what lands in the bank: no tax is worked on it, and no ${potName} share.` : "The additional monthly amount is what lands in the bank: no tax is worked on it.");
  notes.push("The Charity line is left out of Expenses: the line above Take-home covers it.");
  if (otherTaxes === 0) notes.push("State and local taxes are not estimated; type them from a pay stub under Settings, Salary.");

  // No negative zero: a $0.00 line is plain zero, whichever side it sits on.
  const plain = (lines: StatementLine[]) => lines.map((l) => (l.cents === 0 ? { ...l, cents: 0 } : l));
  return {
    yearly: plain([...yearlyUpper, ...lower("yearly", paycheckYear, charityYear, lineWinsYear)]),
    monthly: plain([...monthlyUpper, ...lower("monthly", paycheckMonth, charityMonth, lineWinsMonth)]),
    notes,
  };
}

// ---------------------------------------------------------------------------
// The bridge line in the top bar's take-home panel
// ---------------------------------------------------------------------------

export interface TakeHomeBridge {
  /** The top bar's Monthly budget: every budget line, the Charity line included. */
  monthlyBudgetCents: number;
  /** The Charity line as Monthly budget counts it (raised to a what-if salary's maaser when that is more). */
  charityLineCents: number;
  /** Goal savings switched on under the active what-if, a month (they are never in Monthly budget). */
  goalSavingCents: number;
  /**
   * Monthly budget, less the Charity line, plus the goal savings: Take-home needed, a month.
   * Always, since both price the usual month.
   */
  takeHomeNeededCents: number;
}

/** One function for the bar's Take-home needed and the line that explains it, so the two cannot drift. */
export function takeHomeBridge(monthlyBudgetCents: number, charityLineCents: number, goalSavingCents: number): TakeHomeBridge {
  return {
    monthlyBudgetCents,
    charityLineCents,
    goalSavingCents,
    takeHomeNeededCents: monthlyBudgetCents - charityLineCents + goalSavingCents,
  };
}
