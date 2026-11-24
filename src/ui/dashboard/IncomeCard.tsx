// src/ui/dashboard/IncomeCard.tsx -- "Income this month": This month so far's twin, directly under it. Income from
// the 1st through today against last month, the biggest payers, and what
// investments paid on a line of its own. Display only; every figure opens the
// ledger behind it (src/domain/income-month.ts keeps each equal to its ledger).
//
// App-specific business UI wired to the user's data, so no registry search: it is
// ThisMonthCard's layout (itself modeled on @shadcnblocks/stats7).
//
// Given `ended`, a past month in full: the whole
// month's income against the whole month before, named for the month, with every
// ledger's Back returning to that month. Without it, exactly as before.
import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { compareFigures, isMonthEnd } from "../../domain/compare";
import type { IncomeMonthToDate } from "../../domain/income-month";
import { formatDateRange, formatPeriodLabel } from "../../domain/period";
import { formatCents } from "../../domain/money";
import { ledgerHref } from "../lib/ledger-link";

const FIGURE = "font-mono tabular-nums text-2xl";
const BACK = "#/dashboard";

/** A past month the card shows in full. */
export interface EndedIncomeView {
  /** YYYY-MM */
  month: string;
  /** Where every ledger's Back returns: the Dashboard on this month. */
  back: string;
}

function Ledger({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a data-ledger="1" href={href} className="underline-offset-4 hover:underline">
      {children}
    </a>
  );
}

function ComparisonNote({ income, ended }: { income: IncomeMonthToDate; ended: EndedIncomeView | null }) {
  const through = ended
    ? `${formatDateRange(income.period.from, income.period.to).replace(/, \d{4}$/, "")}.`
    : `Through ${formatDateRange(income.period.to, income.period.to).replace(/, \d{4}$/, "")}.`;
  const back = ended ? ended.back : BACK;
  if (!income.baseline) {
    return (
      <p data-testid="dash-income-note" className="pt-1 text-xs text-muted-foreground">
        {through} Not enough history to compare with {ended ? "the month before" : "last month"}.
      </p>
    );
  }
  const c = compareFigures(income.cents, income.baseline.cents, "income");
  const word = c.direction === "up" ? "Up" : c.direction === "down" ? "Down" : "No change";
  const pct = c.changePct == null ? "n/a" : `${c.changePct > 0 ? "+" : ""}${c.changePct.toFixed(1)}%`;
  const dollars = c.changeCents > 0 ? `+${formatCents(c.changeCents)}` : formatCents(c.changeCents);
  // On a month end the shared rule compares with ALL of last month, so the
  // note does not claim "same days" it is not using.
  const before = formatPeriodLabel(income.baseline.range.from.slice(0, 7));
  const which = ended ? `${before.split(" ")[0]}, whole month:` : isMonthEnd(income.baseline.range.to) ? "Last month:" : "Last month, same days:";
  return (
    <p data-testid="dash-income-note" className="pt-1 text-xs text-muted-foreground">
      {through} {which}{" "}
      <a
        data-ledger="1"
        className="font-mono tabular-nums underline-offset-4 hover:underline"
        href={ledgerHref({ label: ended ? `Income, ${before}` : "Income, last month", back, kind: "income", ...income.baseline.range })}
      >
        {formatCents(income.baseline.cents)}
      </a>{" "}
      <span
        data-testid="dash-income-change"
        data-favorable={c.favorable == null ? "none" : String(c.favorable)}
        title={c.favorable == null ? word : `${word}, ${c.favorable ? "favorable" : "unfavorable"}`}
        className={`font-mono tabular-nums ${c.favorable == null ? "" : c.favorable ? "text-positive" : "text-destructive"}`}
      >
        {dollars} ({pct})
      </span>
    </p>
  );
}

export default function IncomeCard({ income, ended = null }: { income: IncomeMonthToDate | null; ended?: EndedIncomeView | null }) {
  const full = ended ? formatPeriodLabel(ended.month) : null;
  return (
    <Card aria-label={full ? `Income, ${full}` : "Income this month"} foldId="dash-income">
      <CardHeader>
        <CardTitle className="text-base">{full ? `Income in ${full}` : "Income this month"}</CardTitle>
        <CardDescription>{full ? "What came in during the month, and who it came from." : "What has come in since the 1st, and who it came from."}</CardDescription>
      </CardHeader>
      <CardContent>{income ? <IncomeBody income={income} ended={ended} /> : <Skeleton data-testid="income-loading" className="h-32 w-full" />}</CardContent>
    </Card>
  );
}

function IncomeBody({ income, ended }: { income: IncomeMonthToDate; ended: EndedIncomeView | null }) {
  const range = { from: income.period.from!, to: income.period.to! };
  // The current month keeps its words and its plain Back; a past month names itself.
  const full = ended ? formatPeriodLabel(ended.month) : null;
  const which = full ?? "this month";
  const back = ended ? ended.back : BACK;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{full ? "Income for the month" : "Income so far"}</div>
        <div data-testid="dash-figure-income-this-month" className={FIGURE}>
          {income.cents === 0 ? (
            formatCents(0)
          ) : (
            <Ledger href={ledgerHref({ label: `Income, ${which}`, back, kind: "income", ...range })}>
              {formatCents(income.cents)}
            </Ledger>
          )}
        </div>
        <ComparisonNote income={income} ended={ended} />
        {income.investmentIncomeCents !== 0 && (
          <p data-testid="income-investments" className="pt-1 text-xs text-muted-foreground">
            Investments paid{" "}
            <a
              data-ledger="1"
              className="font-mono tabular-nums underline-offset-4 hover:underline"
              href={ledgerHref({ label: `Investment income, ${which}`, back, kind: "investment_income", ...range })}
            >
              {formatCents(income.investmentIncomeCents)}
            </a>
          </p>
        )}
      </div>
      <div>
        <div className="pb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Top sources</div>
        {income.topSources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{full ? `No income in ${full}.` : "No income yet this month."}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {income.topSources.map((s) => (
              <li key={s.payeeKey || "unnamed"} data-testid={`income-source-${s.payeeKey || "unnamed"}`} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="truncate">{s.label}</span>
                <span className="font-mono tabular-nums">
                  {/* No payer name means nothing to filter on: a link would open all income,
                      so it is listed but not clickable. */}
                  {s.payeeKey ? (
                    <Ledger href={ledgerHref({ label: s.label, back, kind: "income", payeeKey: s.payeeKey, ...range })}>
                      {formatCents(s.cents)}
                    </Ledger>
                  ) : (
                    formatCents(s.cents)
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
