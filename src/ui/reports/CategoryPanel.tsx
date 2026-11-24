// src/ui/reports/CategoryPanel.tsx
//
// Reports, Spending and Income. In reading order:
//
// 1. The period total, with the purchases and refunds behind it and the monthly
//    average.
// 2. The chart (ReportChart), grouped to fit the period, drilling down by click.
// 3. The ranked list: each category's total, its share of purchases and its
//    monthly average; "Other" opens into the categories folded into it; refunds
//    and credits on their own line; the comparison columns, when one is chosen.
// 4. The monthly table, Category pinned left and Total pinned right.
//
// Every summed figure opens Transactions as a ledger of the rows behind it, and
// that ledger's total equals the figure to the cent. A category's figure is its
// purchases (money out only); the refunds line is money in only; a total is both.
//
// Group by Category or Merchant: grouped by merchant,
// the same entries stand under their shown merchant name (byMerchant), so the total,
// the chart, the ranked list and the monthly table follow with no second code path;
// a merchant's name opens its page, and its figures open ledgers of its rows. The
// category box still narrows first.
//
// How the panel reads:
// - Every monthly average divides by complete months only: a month the
//   period cuts short, or the month not over yet, stays in the totals but not the
//   average (monthlyAverage, shared with the merchant page).
// - A click on a month or week bar narrows the whole panel to it: the
//   total, the ranked list, the monthly table and every ledger follow that stretch
//   until "Back to the whole period". The section owns the choice and keeps it in the link.
import { useMemo, useState } from "react";
import { ChevronRightIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { formatCents } from "../../domain/money";
import { clampToPeriod, customPeriod, formatDateRange, formatMonthShort, monthBounds, monthHeading, type Period } from "../../domain/period";
import { compareFigures } from "../../domain/compare";
import {
  REFUNDS_LABEL,
  byMerchant,
  flowBaseline,
  monthlyAverage,
  spendingView,
  type DateRange,
  type ReportEntry,
  type ReportSide,
} from "../../domain/report-view";
import type { CategoryMonthSeries } from "../../domain/reports";
import { ledgerHref, type LedgerSpec } from "../lib/ledger-link";
import CategoryFilter from "./CategoryFilter";
import ReportChart, { TOP_N, type Drill } from "./ReportChart";
import {
  CLICK_HINT,
  ChangeCells,
  FIGURE_CELL,
  FIGURE_HEAD,
  Figure,
  MONEY,
  ROW_LABEL,
  type ActiveComparison,
} from "./shared";

const OTHER_LABEL = "Other";
// Total stays in view at the right edge while the months scroll under it.
const TOTAL_PIN = "sticky right-0 z-10 bg-card";

/** Whole percent of purchases; a sliver reads "<1%" rather than a misleading 0%. */
export function shareText(cents: number, purchasesCents: number): string {
  if (purchasesCents <= 0) return "";
  const pct = (cents / purchasesCents) * 100;
  if (pct > 0 && pct < 0.5) return "<1%";
  return `${Math.round(pct)}%`;
}

/** "the 2 complete months, Aug 2026 to Sep 2026", "the 1 complete month, Jul 2026". */
function completeMonthsText(months: string[]): string {
  const n = months.length;
  const which = n === 1 ? formatMonthShort(months[0]) : `${formatMonthShort(months[0])} to ${formatMonthShort(months[n - 1])}`;
  return `the ${n} complete ${n === 1 ? "month" : "months"}, ${which}`;
}

export type ReportGroup = "category" | "merchant";

export interface CategoryPanelProps {
  kind: ReportSide;
  /** Every counted entry on this side, any dates; the panel cuts them to the range. */
  entries: ReportEntry[];
  /** The days the report covers, or null when there is no history. */
  range: DateRange | null;
  period: Period;
  today: string;
  back: string;
  comparison: ActiveComparison | null;
  caption: string | null;
  /** The budget lines chosen (Spending only); empty means every line. */
  chosen: string[];
  /** Offered to choose from. With no `onChoose`, there is nothing to choose. */
  options: string[];
  onChoose?: (next: string[]) => void;
  /** What the lines are: budget lines (the default) or merchants. */
  group?: ReportGroup;
  onGroup?: (next: ReportGroup) => void;
  /** A merchant's page, for its name, with the dates the panel shows. */
  merchantLink?: (name: string, shown: Period) => string;
  /** The month or week the whole panel is narrowed to, or null for the whole period. */
  drill?: Drill | null;
  onDrill?: (next: Drill | null) => void;
}

export default function CategoryPanel({
  kind,
  entries,
  range,
  period,
  today,
  back,
  comparison: comparisonProp,
  caption,
  chosen,
  options,
  onChoose,
  group = "category",
  onGroup,
  merchantLink,
  drill = null,
  onDrill,
}: CategoryPanelProps) {
  const [otherOpen, setOtherOpen] = useState(false);
  const refundsApart = kind === "expense";
  const byShop = group === "merchant";
  const shownEntries = useMemo(() => {
    const keep = new Set(chosen);
    const narrowedEntries = chosen.length === 0 ? entries : entries.filter((e) => keep.has(e.category));
    // Narrow by budget line first, then stand each entry under its merchant.
    return byShop ? byMerchant(narrowedEntries) : narrowedEntries;
  }, [entries, chosen, byShop]);
  // Narrowed to a clicked month or week, every figure below reads that stretch.
  const shownRange: DateRange | null = range && drill ? { from: drill.from, to: drill.to } : range;
  const view = useMemo(() => (shownRange ? spendingView(shownEntries, shownRange, refundsApart) : null), [shownEntries, shownRange?.from, shownRange?.to, refundsApart]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupToggle = onGroup ? (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Group by</span>
      <ToggleGroup
        value={[group]}
        onValueChange={(v: unknown[]) => {
          if (v.length > 0) onGroup(v[0] as ReportGroup);
        }}
        aria-label="Group by"
        variant="outline"
        size="sm"
        spacing={0}
      >
        <ToggleGroupItem value="category">Category</ToggleGroupItem>
        <ToggleGroupItem value="merchant">Merchant</ToggleGroupItem>
      </ToggleGroup>
    </div>
  ) : null;
  const filter =
    onChoose || groupToggle ? (
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {groupToggle}
        {onChoose && <CategoryFilter options={options} chosen={chosen} onChoose={onChoose} />}
      </div>
    ) : null;

  if (!range || !shownRange || !view || (view.lines.length === 0 && !view.refunds)) {
    return (
      <div className="flex flex-col gap-4">
        {filter}
        <p className="text-sm text-muted-foreground">
          {chosen.length > 0
            ? "Nothing in the chosen categories over this period."
            : kind === "expense"
              ? "No spending yet."
              : "No income yet."}
        </p>
      </div>
    );
  }

  const kindWord = kind === "expense" ? "Spending" : "Income";
  const groupWord = byShop ? "Merchant" : "Category";
  const groupPlural = byShop ? "merchants" : "categories";
  // The dates every figure and ledger below reads: the clicked month or week, else the period.
  const shownPeriod: Period = drill ? customPeriod(drill.from, drill.to) : period;
  const rangeTo = drill ? drill.to : period.to ?? today;
  // Complete months only: the same rule as the merchant page, by the same function.
  const average = monthlyAverage(view.totalByMonth, shownRange, today);
  const avgText = (s: CategoryMonthSeries) => {
    const a = monthlyAverage(s.byMonth, shownRange, today).averageCents;
    return a == null ? "" : formatCents(a);
  };
  const narrowed = chosen.length > 0 ? chosen : undefined;

  // The ranked lines, the top 8 and Other. Other is a sum like any other row, so
  // it opens a ledger of every category folded into it.
  const top = view.lines.slice(0, TOP_N);
  const foldedLines = view.lines.slice(TOP_N);
  const folded = foldedLines.map((l) => l.category);
  const other: CategoryMonthSeries | null = foldedLines.length
    ? foldedLines.reduce<CategoryMonthSeries>(
        (acc, l) => {
          acc.total += l.total;
          for (const [m, c] of Object.entries(l.byMonth)) acc.byMonth[m] = (acc.byMonth[m] ?? 0) + c;
          return acc;
        },
        { category: OTHER_LABEL, total: 0, byMonth: {} }
      )
    : null;
  const isOther = (s: CategoryMonthSeries) => s === other;
  const isRefunds = (s: CategoryMonthSeries) => s === view.refunds;
  const categoriesOf = (s: CategoryMonthSeries) => (isOther(s) ? folded : isRefunds(s) ? narrowed : [s.category]);
  const labelOf = (s: CategoryMonthSeries) => (isOther(s) ? `Other (${folded.length} ${groupPlural})` : s.category);
  const flowOf = (s: CategoryMonthSeries) => (!refundsApart ? undefined : isRefunds(s) ? ("in" as const) : ("out" as const));
  const topNames = top.map((l) => l.category);
  /**
   * The rows behind a line. By category: its budget lines. By merchant: the chosen
   * budget lines, and the merchant (or, for Other, every merchant but the top 8,
   * which is exactly what Other adds up).
   */
  const rowsOf = (s: CategoryMonthSeries): Pick<LedgerSpec, "categories" | "merchants" | "exceptMerchants"> => {
    if (!byShop) return { categories: categoriesOf(s) };
    if (isRefunds(s)) return { categories: narrowed };
    if (isOther(s)) return { categories: narrowed, exceptMerchants: topNames };
    return { categories: narrowed, merchants: [s.category] };
  };

  // A label says WHAT the ledger is; the ledger's date line says WHEN.
  const lineSpec = (s: CategoryMonthSeries, dates: { from: string | null; to: string | null }): LedgerSpec => ({
    label: labelOf(s),
    back,
    ...rowsOf(s),
    kind,
    flow: flowOf(s),
    ...dates,
  });
  /** A merchant's name opens its page; a category's name stays as it was. */
  const nameCell = (s: CategoryMonthSeries) =>
    byShop && merchantLink ? (
      <a href={merchantLink(s.category, shownPeriod)} className="text-foreground underline-offset-4 hover:underline">
        {s.category}
      </a>
    ) : (
      s.category
    );
  const periodDates = { from: shownPeriod.from, to: shownPeriod.to };
  const monthDates = (month: string) => clampToPeriod(monthBounds(month), shownPeriod);
  const totalSpec = (dates: { from: string | null; to: string | null }): LedgerSpec => ({
    label: narrowed ? narrowed.join(", ") : kindWord,
    back,
    kind,
    categories: narrowed,
    ...dates,
  });

  // A comparison is for the whole period: while narrowed it steps aside (and says so).
  const comparison = drill ? null : comparisonProp;
  // The comparison, split the same way as the period: each category's purchases,
  // the refunds, and the net total. A group is summed first and averaged once, so
  // it equals what its ledger shows. It opens a ledger only when it is ONE stretch of days.
  const base = comparison ? flowBaseline(shownEntries, comparison.baseline.ranges, refundsApart) : null;
  const divideBy = comparison?.baseline.divideBy ?? 1;
  const baselineOf = (s: CategoryMonthSeries) => {
    if (!base) return 0;
    if (isRefunds(s)) return Math.round(base.refundsRaw / divideBy);
    let raw = 0;
    if (byShop && isOther(s)) {
      // Every merchant but the top 8, as its ledger lists them.
      for (const [m, cents] of base.raw) if (!topNames.includes(m)) raw += cents;
    } else {
      for (const c of categoriesOf(s) ?? []) raw += base.raw.get(c) ?? 0;
    }
    return Math.round(raw / divideBy);
  };
  const baselineTotal = base ? Math.round(base.totalRaw / divideBy) : 0;
  const baselineSpec = (spec: LedgerSpec): LedgerSpec | null =>
    comparison?.baseline.ledgerRange
      ? {
          ...spec,
          label: `${spec.label}, ${comparison.label.toLowerCase()}`,
          ...comparison.baseline.ledgerRange,
          divideBy: comparison.baseline.divideBy > 1 ? comparison.baseline.divideBy : undefined,
        }
      : null;
  const BaselineCell = ({ id, cents, spec }: { id: string; cents: number; spec: LedgerSpec | null }) => (
    <td data-testid={`baseline-${id}`} className={`${FIGURE_CELL} ${MONEY} text-muted-foreground`}>
      {spec ? <Figure cents={cents} spec={spec} /> : formatCents(cents)}
    </td>
  );
  const marker = comparison?.segments
    ? (month: string) => {
        const segment = comparison.segments!.find((s) => s.month === month);
        if (!segment) return null;
        return Math.round(flowBaseline(shownEntries, segment.ranges, false).totalRaw / segment.divideBy);
      }
    : null;

  // A function, not a component: a component made inside render would remount on
  // every render, and the Other button would lose keyboard focus when pressed.
  const rankRow = (s: CategoryMonthSeries, nested = false) => {
    const id = isRefunds(s) ? REFUNDS_LABEL : s.category;
    return (
      <tr key={`${id}${isOther(s) ? ":other" : ""}`} data-rank-row={id} className="border-b last:border-0">
        <td className={`py-1.5 pr-2 ${nested ? "pl-6 text-muted-foreground" : ""}`}>
          {isOther(s) ? (
            <button
              type="button"
              aria-expanded={otherOpen}
              onClick={() => setOtherOpen((open) => !open)}
              className="inline-flex min-h-6 items-center gap-1 text-left underline-offset-4 hover:underline"
            >
              <ChevronRightIcon aria-hidden="true" className={`size-4 ${otherOpen ? "rotate-90" : ""}`} />
              {`Other (${folded.length} ${groupPlural})`}
            </button>
          ) : isRefunds(s) ? (
            s.category
          ) : (
            nameCell(s)
          )}
        </td>
        <td data-testid={`rank-total-${id}`} className={`${FIGURE_CELL} font-medium ${MONEY}`}>
          <Figure cents={s.total} spec={lineSpec(s, periodDates)} />
        </td>
        <td data-testid={`rank-share-${id}`} className={`${FIGURE_CELL} ${MONEY} text-muted-foreground`}>
          {isRefunds(s) ? "" : shareText(s.total, view.purchasesCents)}
        </td>
        <td data-testid={`rank-avg-${id}`} className={`${FIGURE_CELL} ${MONEY}`}>
          {avgText(s)}
        </td>
        {comparison && !nested && (
          <>
            <BaselineCell id={id} cents={baselineOf(s)} spec={baselineSpec(lineSpec(s, periodDates))} />
            <ChangeCells c={compareFigures(s.total, baselineOf(s), kind)} idSuffix={id} />
          </>
        )}
        {comparison && nested && <td colSpan={3} />}
      </tr>
    );
  };

  const tableLines: CategoryMonthSeries[] = [...top, ...(other ? [other] : []), ...(view.refunds ? [view.refunds] : [])];

  return (
    <div className="flex flex-col gap-4">
      {filter}
      <Card>
        <CardHeader>
          <CardDescription data-testid="summary-scope">
            {kindWord}, {formatDateRange(shownRange.from, shownRange.to)}
            {narrowed ? `, ${narrowed.join(", ")} only` : ""}
            {byShop ? ", by merchant" : ""}
          </CardDescription>
          <CardTitle className="text-xl">
            {kind === "expense" ? "Spent " : "Received "}
            <span data-testid="summary-total" className={MONEY}>
              {formatCents(view.totalCents)}
            </span>
          </CardTitle>
          {view.refunds && (
            <p className="text-sm text-muted-foreground">
              <span data-testid="summary-purchases" className={MONEY}>
                {formatCents(view.purchasesCents)}
              </span>{" "}
              of purchases, less{" "}
              <span data-testid="summary-refunds" className={MONEY}>
                {formatCents(-view.refunds.total)}
              </span>{" "}
              that came back as refunds and credits.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {average.averageCents != null && (
              <>
                <span data-testid="summary-average" className={MONEY}>
                  {formatCents(average.averageCents)}
                </span>{" "}
                a month on average,{" "}
              </>
            )}
            <span data-testid="summary-average-note">
              {average.averageCents != null
                ? `over ${completeMonthsText(average.months)}. A month the period cuts short, or one not over yet, is in the total but not the average.`
                : "No complete month in this period yet, so there is no monthly average."}
            </span>
          </p>
        </CardHeader>
        <CardContent>
          <ReportChart
            kind={kind}
            entries={shownEntries}
            range={range}
            drilled={drill}
            onDrill={onDrill}
            rangeTo={rangeTo}
            today={today}
            ranked={view.lines.map((l) => l.category)}
            refundsApart={refundsApart}
            chosen={chosen}
            group={group}
            back={back}
            marker={marker}
            markerLabel={comparison?.label ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p data-testid="click-hint" className="pb-3 text-xs text-muted-foreground">{CLICK_HINT}</p>
          {drill && comparisonProp ? (
            <p data-testid="drill-compare-note" className="pb-3 text-sm text-muted-foreground">
              The comparison is for the whole period. Press Back to the whole period to see it again.
            </p>
          ) : (
            caption && (
              <p data-testid="compare-caption" className="pb-3 text-sm">
                {caption}
              </p>
            )
          )}
          <div className="overflow-x-auto">
            <table data-testid="ranked-list" className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-2">{groupWord}</th>
                  <th className={FIGURE_HEAD}>Total</th>
                  <th className={FIGURE_HEAD} title={refundsApart ? "Share of all purchases, before refunds" : "Share of everything received"}>
                    Share
                  </th>
                  <th
                    className={FIGURE_HEAD}
                    title={average.months.length > 0 ? `Added up over ${completeMonthsText(average.months)}, then divided by ${average.months.length}` : "No complete month yet"}
                  >
                    Monthly average
                  </th>
                  {comparison && (
                    <>
                      <th className={FIGURE_HEAD}>{comparison.label}</th>
                      <th className={FIGURE_HEAD}>Change</th>
                      <th className={FIGURE_HEAD}>Change %</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {top.map((s) => rankRow(s))}
                {other && rankRow(other)}
                {other && otherOpen && foldedLines.map((s) => rankRow(s, true))}
                {view.refunds && rankRow(view.refunds)}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium">
                  <td className="py-1.5 pr-2">Total</td>
                  <td data-testid="rank-grand-total" className={`${FIGURE_CELL} ${MONEY}`}>
                    <Figure cents={view.totalCents} spec={totalSpec(periodDates)} />
                  </td>
                  <td className={FIGURE_CELL} />
                  <td data-testid="rank-grand-avg" className={`${FIGURE_CELL} ${MONEY}`}>
                    {average.averageCents == null ? "" : formatCents(average.averageCents)}
                  </td>
                  {comparison && (
                    <>
                      <BaselineCell id="total" cents={baselineTotal} spec={baselineSpec(totalSpec(periodDates))} />
                      <ChangeCells c={compareFigures(view.totalCents, baselineTotal, kind)} idSuffix="total" />
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>{kindWord}, per month</CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="overflow-x-auto">
            <table data-testid="monthly-table" className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className={`pb-2 ${ROW_LABEL}`}>{groupWord}</th>
                  {view.months.map((m) => (
                    <th key={m} className={FIGURE_HEAD}>
                      {monthHeading(m, rangeTo)}
                    </th>
                  ))}
                  <th className={`${FIGURE_HEAD} ${TOTAL_PIN} pr-2`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {tableLines.map((s) => {
                  const id = isRefunds(s) ? REFUNDS_LABEL : s.category;
                  return (
                    <tr key={id + (isOther(s) ? ":other" : "")} className="border-b last:border-0">
                      <td className={`py-1.5 ${ROW_LABEL}`}>
                        {isOther(s) || isRefunds(s) ? (
                          <span className="text-muted-foreground">{isOther(s) ? OTHER_LABEL : REFUNDS_LABEL}</span>
                        ) : (
                          <a
                            data-ledger={byShop && merchantLink ? undefined : "1"}
                            data-testid={`report-link-${s.category}`}
                            href={byShop && merchantLink ? merchantLink(s.category, shownPeriod) : ledgerHref(lineSpec(s, periodDates))}
                            className="text-foreground underline-offset-4 hover:underline"
                          >
                            {s.category}
                          </a>
                        )}
                      </td>
                      {view.months.map((m) => (
                        <td key={m} data-testid={`cell-${id}-${m}`} className={`${FIGURE_CELL} ${MONEY}`}>
                          <Figure cents={s.byMonth[m] ?? 0} spec={lineSpec(s, monthDates(m))} />
                        </td>
                      ))}
                      <td data-testid={`report-total-${id}`} className={`${FIGURE_CELL} ${TOTAL_PIN} pr-2 font-medium ${MONEY}`}>
                        <Figure cents={s.total} spec={lineSpec(s, periodDates)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr data-testid="report-totals-row" className="border-t font-medium">
                  <td className={`py-1.5 ${ROW_LABEL}`}>Total</td>
                  {view.months.map((m) => (
                    <td key={m} data-testid={`month-total-${m}`} className={`${FIGURE_CELL} ${MONEY}`}>
                      <Figure cents={view.totalByMonth[m] ?? 0} spec={totalSpec(monthDates(m))} />
                    </td>
                  ))}
                  <td data-testid="report-grand-total" className={`${FIGURE_CELL} ${TOTAL_PIN} pr-2 ${MONEY}`}>
                    <Figure cents={view.totalCents} spec={totalSpec(periodDates)} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
