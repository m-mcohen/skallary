// src/ui/dashboard/ThisMonthCard.tsx -- "This month so far": how is this month going? Spending from the 1st through today
// against the same days of last month, what is left over so far, and the five
// biggest spending categories. Display only: nothing here feeds the runway. Every
// figure is a sum of transactions, so every figure opens the ledger behind it.
//
// Built from the app's own Card.
//
// Monarch's chart. Spending by day this month against last month or the
// average month, picked in the card's dropdown; the sentence under "Spent this
// month" followed it. Superseded (below): both, always.
//
// The Dashboard can show a past month.
// Given `ended`, the card shows how that month ended: the whole month's spending
// against the whole month before (or the average month), what was left over, the
// top categories, and the month's budget against what was spent. Without it the
// card is exactly the current month's, as before.
//
// Under Spent this month, BOTH same-days
// comparisons at once, last month's and the average month's, so the dropdown that
// picked one of them (and the choice it remembered in this browser) is gone and
// the chart draws both lines. Each top category also shows its spending by the
// same day last month, opening that category's ledger for those days. A past month
// shows the same pair whole month against whole month.
//
// The chart moved to its own card (SpendingChartCard),
// this card sits beside Income, so its body is one column, and Top categories
// folds away (TopCategories).
import type { ReactNode } from "react";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import InfoPoint from "../help/InfoPoint";
import { compareFigures, shiftMonths, type MonthToDate } from "../../domain/compare";
import { formatDateRange, formatPeriodLabel, monthBounds, periodToQuery } from "../../domain/period";
import { formatCents } from "../../domain/money";
import { comparisonDay, type SpendingCurves } from "../../domain/spending-curve";
import type { BudgetAgainstActual } from "../../domain/dashboard-month";
import { ledgerHref } from "../lib/ledger-link";
import TopCategories from "./TopCategories";
import CompareMenu from "./CompareMenu";
import { useTicks } from "./compare-ticks";

const FIGURE = "font-mono tabular-nums text-2xl";

/** A past month the card shows in full. */
export interface EndedMonthView {
  /** YYYY-MM */
  month: string;
  budget: BudgetAgainstActual;
  /** Where every ledger's Back returns: the Dashboard on this month. */
  back: string;
}

/** "August 2026" and "August", for the card's words. */
function names(month: string) {
  const full = formatPeriodLabel(month);
  return { full, name: full.split(" ")[0] };
}

function Ledger({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a data-ledger="1" href={href} className="underline-offset-4 hover:underline">
      {children}
    </a>
  );
}

function Change({ current, baseline, testId = "dash-spent-change" }: { current: number; baseline: number; testId?: string }) {
  const c = compareFigures(current, baseline, "expense");
  const word = c.direction === "up" ? "Up" : c.direction === "down" ? "Down" : "No change";
  const pct = c.changePct == null ? "n/a" : `${c.changePct > 0 ? "+" : ""}${c.changePct.toFixed(1)}%`;
  const dollars = c.changeCents > 0 ? `+${formatCents(c.changeCents)}` : formatCents(c.changeCents);
  return (
    <span
      data-testid={testId}
      data-favorable={c.favorable == null ? "none" : String(c.favorable)}
      title={c.favorable == null ? word : `${word}, ${c.favorable ? "favorable" : "unfavorable"}`}
      className={`font-mono tabular-nums ${c.favorable == null ? "" : c.favorable ? "text-positive" : "text-destructive"}`}
    >
      {dollars} ({pct})
    </span>
  );
}

const NOTE = "pt-1 text-xs text-muted-foreground";
const AMOUNT = "font-mono tabular-nums";
const LINKED = `${AMOUNT} underline-offset-4 hover:underline`;

/** "Aug 1 to Aug 20": a range in the card's short words, no year. */
const shortRange = (from: string, to: string) => formatDateRange(from, to).replace(/, \d{4}$/, "");

/** "October 2025" from "2025-10". */
const monthYear = (month: string) => formatPeriodLabel(month);

/** Reports on the card's own days, compared with the 3-month average, category by category. */
export function reportsHref(spent: MonthToDate, ended: boolean): string {
  // A past month names its dates; "this-month" would re-read as today's month.
  const period = ended ? { from: spent.period.from!, to: spent.period.to! } : periodToQuery(spent.period);
  // allcat=1: every category, never a pick left over from an earlier visit to Reports.
  return `#/reports?${new URLSearchParams({ ...period, compare: "avg-3", allcat: "1" }).toString()}`;
}

/**
 * The comparisons under the spending figure, one line for each comparison ticked in
 * Compare with (compare-ticks.ts), in its order. Last month and the same month last
 * year open their ledgers. The averages do not: each is several separate stretches
 * of days, which one list cannot show; the "Average spent, last 12 months" tile opens
 * its months. On a past month (`ended`) each is a whole month: the whole month before,
 * the whole month a year before, and the whole average month, whose Day 31 is each of
 * the months before in full.
 */
function SpentComparisons({ spent, curves, ended }: { spent: MonthToDate; curves: SpendingCurves | null; ended: EndedMonthView | null }) {
  const ticks = useTicks();
  const lead = ended ? `${shortRange(spent.period.from!, spent.period.to!)}.` : `Through ${shortRange(spent.period.to!, spent.period.to!)}.`;
  const back = ended ? ended.back : "#/dashboard";
  const at = curves ? (ended ? curves.days - 1 : comparisonDay(curves) - 1) : 0;
  // This month's last day: the month is whole, so every line says so.
  const lastDay = !ended && spent.period.to === monthBounds(spent.period.to!.slice(0, 7)).to;
  const whole = Boolean(ended) || lastDay;
  const span = ended ? "" : lastDay ? ", whole month" : ", same days";
  const baseline = spent.baseline;
  const before = baseline ? names(baseline.range.from.slice(0, 7)) : null;

  const lastMonthLine = (
    <p key="lastMonth" data-testid="dash-spent-vs-last" className={NOTE}>
      {!baseline || !before ? (
        `Not enough history to compare with ${ended ? "the month before" : "last month"}.`
      ) : (
        <>
          {ended
            ? `${before.name}, whole month: `
            : `Last month, ${lastDay ? "whole month" : "same days"} (${shortRange(baseline.range.from, baseline.range.to)}): `}
          <a
            data-ledger="1"
            className={LINKED}
            href={ledgerHref({
              label: ended ? `Spending, ${before.full}` : lastDay ? "Spending, last month" : "Spending, last month, same days",
              back,
              kind: "expense",
              ...baseline.range,
            })}
          >
            {formatCents(baseline.cents)}
          </a>{" "}
          <Change current={spent.cents} baseline={baseline.cents} />
        </>
      )}
    </p>
  );

  const lastYearLine = () => {
    const yearAgo = { from: shiftMonths(spent.period.from!, -12, false), to: shiftMonths(spent.period.to!, -12, whole) };
    const name = monthYear(yearAgo.from.slice(0, 7));
    const cents = curves?.lastYear?.[at] ?? null;
    return (
      <p key="lastYear" data-testid="dash-spent-vs-last-year" className={NOTE}>
        {cents == null ? (
          `Not enough history to compare with ${name}.`
        ) : (
          <>
            {whole ? `${name}, whole month: ` : `${name}, same days (${shortRange(yearAgo.from, yearAgo.to)}): `}
            <a
              data-ledger="1"
              className={LINKED}
              href={ledgerHref({ label: `Spending, ${name}${whole ? "" : ", same days"}`, back, kind: "expense", ...yearAgo })}
            >
              {formatCents(cents)}
            </a>{" "}
            <Change current={spent.cents} baseline={cents} testId="dash-spent-change-last-year" />
          </>
        )}
      </p>
    );
  };

  const averageLine = (months: 3 | 12) => {
    const line = months === 3 ? curves?.averageThree : curves?.averageMonth;
    const cents = line?.[at] ?? null;
    const testId = months === 3 ? "dash-spent-vs-average-3" : "dash-spent-vs-average";
    return (
      <p key={testId} data-testid={testId} className={NOTE}>
        {cents == null ? (
          `Not enough history to compare with the ${months}-month average.`
        ) : (
          <>
            {`${months}-month average${span}: `}
            <span className={AMOUNT}>{formatCents(cents)}</span>{" "}
            <Change current={spent.cents} baseline={cents} testId={months === 3 ? "dash-spent-change-average-3" : "dash-spent-change-average"} />
          </>
        )}
      </p>
    );
  };

  return (
    <div data-testid="dash-spent-note">
      <p className={NOTE}>{lead}</p>
      {ticks.includes("lastMonth") && lastMonthLine}
      {curves && ticks.includes("lastYear") && lastYearLine()}
      {curves && ticks.includes("averageThree") && averageLine(3)}
      {curves && ticks.includes("averageMonth") && averageLine(12)}
      <p className={NOTE}>
        <a data-testid="dash-spent-reports" className="underline underline-offset-4" href={reportsHref(spent, Boolean(ended))}>
          See by category in Reports
        </a>
      </p>
    </div>
  );
}

/** A past month's budget against what was spent. Red only when over. */
function BudgetAgainst({ ended }: { ended: EndedMonthView }) {
  const { budgetCents, spentCents, differenceCents } = ended.budget;
  const { name } = names(ended.month);
  return (
    <div>
      <div className="flex items-center gap-1.5 pb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        Budget against actual
        <InfoPoint termId="budget-against-actual" />
      </div>
      {budgetCents === 0 ? (
        <p className="text-sm text-muted-foreground">No budget to compare with.</p>
      ) : (
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt>Budget for {name}</dt>
            <dd data-testid="month-budget" className="font-mono tabular-nums">{formatCents(budgetCents)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt>Spent</dt>
            <dd data-testid="month-budget-spent" className="font-mono tabular-nums">{formatCents(spentCents)}</dd>
          </div>
          <p data-testid="month-budget-result" className={differenceCents < 0 ? "text-destructive" : undefined}>
            {differenceCents < 0
              ? `Over budget by ${formatCents(-differenceCents)}`
              : differenceCents === 0
                ? "Exactly on budget"
                : `Under budget by ${formatCents(differenceCents)}`}
          </p>
        </dl>
      )}
    </div>
  );
}

export default function ThisMonthCard({
  spent,
  curves = null,
  ended = null,
}: {
  spent: MonthToDate | null;
  curves?: SpendingCurves | null;
  /** A past month, shown in full. Null: the current month, exactly as before. */
  ended?: EndedMonthView | null;
}) {
  const label = ended ? names(ended.month) : null;
  return (
    <Card aria-label={label ? `Spending, ${label.full}` : "This month so far"} foldId="dash-this-month">
      <CardHeader className="max-sm:has-data-[slot=card-action]:grid-cols-1">
        <CardTitle className="text-base">{label ? label.full : "This month so far"}</CardTitle>
        <CardDescription>
          {label
            ? "How the month ended: what you spent, what was left over, where it went, and the budget against what you spent."
            : "What you have spent since the 1st, what is left over, and where it went."}
        </CardDescription>
        {/* On a phone the menu takes its own line under the words, as on the chart card. */}
        <CardAction className="max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:justify-self-start">
          <CompareMenu testId="month-compare-menu" />
        </CardAction>
      </CardHeader>
      <CardContent>
        {spent ? (
          <MonthBody spent={spent} curves={curves} ended={ended} />
        ) : (
          <Skeleton data-testid="month-loading" className="h-32 w-full" />
        )}
      </CardContent>
    </Card>
  );
}

function MonthBody({
  spent,
  curves,
  ended,
}: {
  spent: MonthToDate;
  curves: SpendingCurves | null;
  ended: EndedMonthView | null;
}) {
  const { from, to } = spent.period;
  const range = { from: from!, to: to! };
  // The current month keeps its words and its plain Back; a past month names itself.
  const label = ended ? names(ended.month) : null;
  const back = ended ? ended.back : "#/dashboard";
  const which = label ? label.full : "this month";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            {label ? `Spent in ${label.name}` : "Spent this month"}
            <InfoPoint termId="spent-this-month" />
          </div>
          <div data-testid="dash-figure-spent-this-month" className={FIGURE}>
            {spent.cents === 0 ? (
              formatCents(0)
            ) : (
              <Ledger href={ledgerHref({ label: `Spending, ${which}`, back, kind: "expense", ...range })}>
                {formatCents(spent.cents)}
              </Ledger>
            )}
          </div>
          <SpentComparisons spent={spent} curves={curves} ended={ended} />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label ? "Left over" : "Left over so far"}</div>
          <div data-testid="month-left-over" className={FIGURE + (spent.leftOverCents < 0 ? " text-destructive" : "")}>
            {spent.leftOverCents === 0 ? (
              formatCents(0)
            ) : (
              <Ledger href={ledgerHref({ label: `Left over, ${which}`, back, kind: null, ...range })}>
                {formatCents(spent.leftOverCents)}
              </Ledger>
            )}
          </div>
          {/* Left over is earned minus spent. A move into
              or out of savings is named here instead of hiding inside it. */}
          {(spent.savingCents ?? 0) !== 0 && (
            <p data-testid="month-saving" className="pt-1 text-xs text-muted-foreground">
              {spent.savingCents > 0 ? "Put into investments" : "Taken from investments"}{" "}
              <a
                data-ledger="1"
                className="font-mono tabular-nums underline-offset-4 hover:underline"
                href={ledgerHref({ label: `Saving, ${which}`, back, kind: "saving", ...range })}
              >
                {formatCents(Math.abs(spent.savingCents))}
              </a>
            </p>
          )}
        </div>
        {ended && <BudgetAgainst ended={ended} />}
      </div>
      <TopCategories
        items={spent.topCategories}
        emptyText={label ? `Nothing spent in ${label.full}.` : "Nothing spent yet this month."}
        renderAmount={(c) => (
          <Ledger href={ledgerHref({ label: c.category, back, categories: [c.category], kind: "expense", ...range })}>
            {formatCents(c.cents)}
          </Ledger>
        )}
        renderBefore={(c) =>
          spent.baseline ? <CategoryBefore category={c.category} baseline={spent.baseline} ended={ended} back={back} /> : null
        }
      />
    </div>
  );
}

/**
 * A top category's spending by the same day last month, or in the
 * whole month before on a past month. It opens that category's ledger for those
 * days, so the ledger adds up to it; nothing on those days reads $0.00 and opens
 * nothing.
 */
function CategoryBefore({
  category,
  baseline,
  ended,
  back,
}: {
  category: string;
  baseline: NonNullable<MonthToDate["baseline"]>;
  ended: EndedMonthView | null;
  back: string;
}) {
  const cents = baseline.byCategory[category] ?? 0;
  const before = names(baseline.range.from.slice(0, 7));
  return (
    <span data-testid={`month-top-${category}-before`} className="text-xs text-muted-foreground">
      {ended ? `${before.name}: ` : "Last month: "}
      {cents === 0 ? (
        <span className={AMOUNT}>{formatCents(0)}</span>
      ) : (
        <a
          data-ledger="1"
          className={LINKED}
          href={ledgerHref({ label: `${category}, ${ended ? before.full : "last month, same days"}`, back, categories: [category], kind: "expense", ...baseline.range })}
        >
          {formatCents(cents)}
        </a>
      )}
    </span>
  );
}
