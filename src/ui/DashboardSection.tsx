// src/ui/DashboardSection.tsx
//
// The landing screen, and the masthead's inheritor.
//
// Retiring the masthead was never about its numbers -- they were good. It was
// about a 480px full-bleed hero sitting above every screen in the app,
// including the eight that did not want it. Here the same figures sit on the
// one screen whose whole job is to show them.
//
// The Dashboard answers "how is this
// month going, and how close am I to my goals?". The runway headline, its curve
// and the Runs out tile left (Runway has its own screen), and the balance sheet
// moved to Accounts, Balances. In their place: This month so far, a Goals card,
// Waiting on you, the small tiles, and the provenance line.
//
// A month bar at the top switches
// months. A past month shows how it ended: the spending, income and recurring
// cards read that whole month, and the spending card adds budget against
// actual. Goals, Waiting on you and the tiles are balances, plans or today's
// list, so they keep today's figure and say "As of today". The month lives in
// the link (#/dashboard?month=2026-08). This month reads exactly as before.
import { useMemo } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import NowSection from "./NowSection";
import ThisMonthCard from "./dashboard/ThisMonthCard";
import SpendingChartCard from "./dashboard/SpendingChartCard";
import RecurringPanel from "./dashboard/RecurringPanel";
import IncomeCard from "./dashboard/IncomeCard";
import GoalsCard from "./dashboard/GoalsCard";
import YearlyHeadsUp from "./dashboard/YearlyHeadsUp";
import { formatPeriodLabel, localDateIso, monthBounds } from "../domain/period";
import { bankProblemShort } from "../domain/bank-problems";
import { monthEnded, monthFromLink, monthNav } from "../domain/dashboard-month";
import MonthBar from "./dashboard/MonthBar";
import { dashboardHref, useMonthInLink } from "./dashboard/month-link";
import { ledgerHref } from "./lib/ledger-link";
import { formatCents } from "../domain/money";
import InfoPoint from "./help/InfoPoint";
import type { HeadState } from "./lib/useMastheadSummary";
import type { ReactNode } from "react";

export interface DashboardSectionProps {
  /** null until the first read lands. */
  summary: HeadState | null;
  planId: string | null;
  onChanged: () => void;
  /** A what-if is on: Monthly budget follows it, Fixed and Variable do not. */
  whatIfOn?: boolean;
  /** The local server cannot be reached: the shell's Not connected banner explains, so no loading blocks or advice here. */
  unavailable?: boolean;
}

// One way to write money: $ always, a minus sign
// for money out, red only for a real shortfall. A budget is a plain amount a
// month, so the red parentheses these tiles carried until then are gone.
const money = (c: number) => formatCents(c);

/**
 * "Trailing 12mo" is the one figure here that is a sum of transactions: the
 * total of twelve complete months, divided by 12. Its ledger spans those months
 * and carries the divisor, so the ledger shows the average and the total it came
 * from. Every other figure on this screen is a balance, a plan line, or a
 * projection, and a list of transactions would not add up to it.
 */
function trailingHref(summary: HeadState, back: string): string | undefined {
  const window = summary.trailingWindow ?? [];
  if (window.length < 2 || summary.trailingCents === 0) return undefined;
  return ledgerHref({
    label: `Spending, trailing ${window.length} months`,
    back,
    kind: "expense",
    from: monthBounds(window[0]).from,
    to: monthBounds(window[window.length - 1]).to,
    divideBy: window.length,
  });
}

function since(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

const FIGURE = "font-mono tabular-nums text-2xl";

/** Under a tile while a past month is shown: the tile is today's figure, whatever the month. */
function asOfToday(id: string) {
  return (
    <p data-testid={`dash-asof-${id}`} className="pt-1 text-xs text-muted-foreground">
      As of today
    </p>
  );
}

/**
 * A stat tile. Not a chart: one number, its label, and nothing else competing
 * for the reading.
 */
function Figure({
  id,
  label,
  value,
  termId,
  href,
  note,
}: {
  id: string;
  label: string;
  value: string;
  /** Set when the figure is a sum of transactions: it then opens the ledger behind it. */
  href?: string;
  /** One line under the figure, for a comparison. */
  note?: ReactNode;
  /** Glossary id: puts an info point beside the label (src/help/glossary.ts). */
  termId?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
          {termId && <InfoPoint termId={termId} />}
        </div>
        <div data-testid={`dash-figure-${id}`} className={FIGURE}>
          {href ? (
            <a data-ledger="1" href={href} className="underline-offset-4 hover:underline">
              {value}
            </a>
          ) : (
            value
          )}
        </div>
        {note}
      </CardContent>
    </Card>
  );
}

function LoadingDashboard() {
  // Skeletons, never zeros: "$0.00" is a claim about the money, and there
  // isn't one yet.
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-64 w-full" />
      <div className="grid gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export default function DashboardSection(props: DashboardSectionProps) {
  if (!props.summary && props.unavailable) return null;
  if (!props.summary) return <LoadingDashboard />;
  return <Dashboard {...props} summary={props.summary} />;
}

function Dashboard({ summary, planId, onChanged, whatIfOn = false }: DashboardSectionProps & { summary: HeadState }) {
  const { reading } = summary;
  const source = summary.monthSource ?? null;
  const today = source?.today ?? localDateIso();
  const [linked, choose] = useMonthInLink(today);
  // Without the rows (not read yet, or the read failed) only this month exists, and there is no bar.
  const month = monthFromLink(source ? linked : null, today, source?.firstMonth ?? null);
  const nav = monthNav(month, today, source?.firstMonth ?? null);
  // A past month, worked once per month chosen. The current month reads what it always read.
  const ended = useMemo(() => (source && !nav.current ? monthEnded(source, month) : null), [source, nav.current, month]);
  const back = dashboardHref(month, today);
  const past = ended != null;
  const note = (id: string) => (past ? asOfToday(id) : undefined);

  // Month bar; the chart alone; spending and
  // income side by side (stacked on a phone); Waiting on you with its link; the tiles;
  // Recurring; Goals; the Fixed and Variable budget cards. A past month keeps the order.
  const curves = ended ? ended.curves : summary.spendingCurves ?? null;
  return (
    <div className="flex flex-col gap-section">
      {source && (
        <div data-dash-section="month" className="flex flex-col gap-1">
          <MonthBar nav={nav} onChoose={choose} />
          {past && (
            <p data-testid="dash-month-note" className="text-xs text-muted-foreground">
              How {formatPeriodLabel(month)} ended. Goals, Waiting on you and the figures below are as of today.
              {whatIfOn && " A what-if never changes a past month: these are what happened."}
            </p>
          )}
        </div>
      )}
      {curves && (
        <div data-dash-section="chart">
          <SpendingChartCard
            curves={curves}
            endedLabel={ended ? formatPeriodLabel(month) : null}
            source={source}
            asOf={ended ? monthBounds(month).to : today}
          />
        </div>
      )}
      <div data-dash-section="spending-income" className="grid items-start gap-section lg:grid-cols-2">
        {ended ? (
          <>
            <ThisMonthCard spent={ended.spent} curves={ended.curves} ended={{ month, budget: ended.budget, back }} />
            <IncomeCard income={ended.income} ended={{ month, back }} />
          </>
        ) : (
          <>
            <ThisMonthCard spent={summary.spentThisMonth ?? null} curves={summary.spendingCurves ?? null} />
            <IncomeCard income={summary.incomeThisMonth ?? null} />
          </>
        )}
      </div>

      {/* The review queue, and the link into the full Transactions screen filtered to
          the same rows, directly under it (4B). */}
      <div data-dash-section="waiting" className="flex flex-col gap-2">
        <NowSection planId={planId} onChanged={onChanged} asOfToday={past} />
        <a href="#/transactions/needs-category" className="self-start px-1 text-xs text-primary hover:underline">
          Review all uncategorized transactions &rarr;
        </a>
      </div>

      {!past && <YearlyHeadsUp />}

      {/* The small tiles. Today's figures whatever the month. */}
      <div data-dash-section="tiles" className="grid gap-section md:grid-cols-2 lg:grid-cols-4">
        <Figure id="drawable" label="Drawable" value={money(reading.drawableCents)} termId="drawable" note={note("drawable")} />
        <Figure id="burn" label="Monthly budget" value={money(reading.burnCents)} termId="burn" note={note("burn")} />
        <Figure id="held-back" label="Held back" value={money(summary.heldBackCents)} termId="held-back" note={note("held-back")} />
        <Figure
          id="trailing"
          label="Average spent, last 12 months"
          value={money(summary.trailingCents)}
          termId="trailing-spending"
          href={trailingHref(summary, back)}
          note={note("trailing")}
        />
      </div>

      <div data-dash-section="recurring">
        {ended ? <RecurringPanel asOfDate={today} pastMonth={month} back={back} /> : <RecurringPanel />}
      </div>

      <div data-dash-section="goals">
        <GoalsCard asOfToday={past} />
      </div>

      <div data-dash-section="budget" className="grid gap-section md:grid-cols-2">
        <Figure
          id="recurring"
          label={whatIfOn ? "Fixed costs (budget, before the what-if)" : "Fixed costs (budget)"}
          termId="recurring-mark"
          value={money(summary.recurringCents)}
          note={note("recurring")}
        />
        <Figure
          id="variable"
          label={whatIfOn ? "Variable costs (budget, before the what-if)" : "Variable costs (budget)"}
          value={money(summary.variableCents)}
          note={note("variable")}
        />
      </div>

      {/* What "Setup" mode's readouts carried: where the numbers came from. */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 px-1 text-xs text-muted-foreground">
        <span>Synced {since(summary.lastSyncedAt)}</span>
        {/* A bank that needs a sign-in no longer fails the sync, so this is
            where it is said. It reads
            the shared bank-problems list, so a quiet bank is named here too. */}
        {summary.bankProblems && summary.bankProblems.length > 0 && (
          <span data-testid="dash-sign-in" className="text-destructive">
            {summary.bankProblems.map((p) => bankProblemShort(p, today)).join(". ")}
          </span>
        )}
        <span>{summary.ruleCount} rules</span>
        <span
          data-testid="dash-seed"
          className={summary.reseedDue ? "text-destructive" : undefined}
        >
          {summary.reseedDue ? "Review due" : "Reviewed"} {since(summary.lastSeedAt)}
        </span>
        <span>{summary.accountCount} accounts</span>
      </div>
    </div>
  );
}
