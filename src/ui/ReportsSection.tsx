// src/ui/ReportsSection.tsx
//
// What you actually spent, made against the same aggregation the Budget uses
// (rollupMonthly -> classify()). Four tabs: Spending, Income, Cash flow, and Left
// over (one column per month; the tab's id stays "net" so old links still open it).
//
// Spending and Income lead with the period total, a chart that drills down, and a ranked list;
// the monthly table follows (reports/CategoryPanel.tsx). The tables are the deliverable: numbers you
// can act on. Every summed figure here (a month cell, a category total, the
// Other row, the bottom totals, a chart bar, and the cash-flow figures) opens
// Transactions as a ledger of the rows behind it, and that ledger's total equals
// the figure to the cent. Both sides go through the same scope (domain/scope.ts)
// so "what did I spend on groceries in July" resolves to a row list that adds up.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChartBase from "./charts/ChartBase";
import { useStable } from "./charts/useStable";
import type { ChartMark, ChartSeries } from "./charts/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  loadDb,
  getTransactionsUI,
  getAccountsUI,
  getRulesUI,
  getTransactionAdjustmentsUI,
  getCategoryMappingsUI,
  getMerchantRenamesUI,
  getZelleMemoNamesUI,
  type Db,
} from "./lib/db";
import { prepareTransactions } from "../domain/pipeline";
import { rollupMonthly, type MonthlyRollup } from "../domain/rollups";
import { cashFlowByMonth, savingsRate, type MonthTotals } from "../domain/reports";
import { bucketsFor, reportEntries, reportRange, type DateRange, type ReportEntry } from "../domain/report-view";
import { merchantOf, renameMap, type MerchantRename, type RenameMap } from "../domain/merchants";
import { formatCents } from "../domain/money";
import { clampToPeriod, formatDateRange, formatMonthShort, inPeriod, monthBounds, periodToQuery, type Period, isPartialMonth, localDateIso, monthHeading } from "../domain/period";
import {
  COMPARE_OPTIONS,
  baselineFor,
  baselineHasHistory,
  baselineSegments,
  compareFigures,
  sumForBaseline,
  type CompareId,
} from "../domain/compare";
import { periodAsOf, pickReportCategories, useCompare, usePeriod, useReportCategories } from "./lib/period-store";
import { ledgerHref, type LedgerSpec } from "./lib/ledger-link";
import CategoryPanel, { type ReportGroup } from "./reports/CategoryPanel";
import type { Drill } from "./reports/ReportChart";
import { merchantHref } from "./lib/merchant-link";
import {
  CLICK_HINT,
  ChangeCells,
  FIGURE_CELL,
  FIGURE_HEAD,
  Figure,
  MONEY,
  PartialMonthNote,
  type ActiveComparison,
} from "./reports/shared";
import type { Account, NormalizedTxn } from "../domain/types";
import type { CategorizationRule } from "../domain/rules";
import type { TransactionAdjustment } from "../domain/adjustments";

export interface ReportsDataLayer {
  loadDb: () => Promise<Db>;
  getTransactions: (db: Db) => Promise<NormalizedTxn[]>;
  getAccounts: (db: Db) => Promise<Account[]>;
  getRules: (db: Db) => Promise<CategorizationRule[]>;
  getAdjustments: (db: Db) => Promise<TransactionAdjustment[]>;
  getCategoryMappings: (db: Db) => Promise<Record<string, string>>;
  /** The merchant rename list. Only the merchant names follow it. */
  getMerchantRenames: (db: Db) => Promise<MerchantRename[]>;
  /** Settings, Merchants: old Zelle rows named by the person in the note. */
  getZelleMemoNames: (db: Db) => Promise<boolean>;
}

const defaultDataLayer: ReportsDataLayer = {
  loadDb,
  getTransactions: getTransactionsUI,
  getAccounts: getAccountsUI,
  getRules: getRulesUI,
  getAdjustments: getTransactionAdjustmentsUI,
  getCategoryMappings: getCategoryMappingsUI,
  getMerchantRenames: getMerchantRenamesUI,
  getZelleMemoNames: getZelleMemoNamesUI,
};

type Tab = "spending" | "income" | "cashflow" | "net";
const TABS: Tab[] = ["spending", "income", "cashflow", "net"];

/**
 * Where a ledger's Back link returns: this screen, on the tab that was open,
 * showing the period that was in view. Without the period, Back would land on
 * whatever was remembered, which may not be what the figure was clicked under.
 */
const backTo = (tab: Tab, period: Period, compare: CompareId, categories: string[] = [], group: ReportGroup = "category", drill: string | null = null) => {
  const q = new URLSearchParams({ tab, ...periodToQuery(period), ...(compare !== "none" ? { compare } : {}) });
  // The budget lines Spending is narrowed to come back with it.
  for (const c of categories) q.append("cat", c);
  // Opened as every category (allcat=1, the Dashboard's See by category): keep saying so on every
  // link this screen builds, until a category is picked by hand (which drops it from the link),
  // or a tab change or a ledger's Back would let the remembered pick come back.
  if (categories.length === 0 && everyCategoryInLink()) q.set("allcat", "1");
  // Grouped by merchant comes back grouped; by category is the absence of the key.
  if (group === "merchant") q.set("group", group);
  // A clicked month or week comes back narrowed, on Spending and Income.
  if (drill && (tab === "spending" || tab === "income")) q.set("drill", drill);
  return `#/reports?${q.toString()}`;
};

/** True while the link says every category (allcat=1). */
function everyCategoryInLink(): boolean {
  const hash = window.location.hash;
  const q = hash.indexOf("?");
  return hash.startsWith("#/reports") && new URLSearchParams(q < 0 ? "" : hash.slice(q + 1)).get("allcat") === "1";
}

/** A month ("2026-07") or a week as the link carries it. */
const drillText = (d: Drill) => (d.kind === "month" ? d.key : `${d.from}_${d.to}`);

/** The clicked month or week the link names, as raw text; checked against the period before use. */
function drillFromHash(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith("#/reports")) return null;
  const q = hash.indexOf("?");
  return new URLSearchParams(q < 0 ? "" : hash.slice(q + 1)).get("drill");
}

/**
 * The link's month or week as a Drill inside `range`, or null. A month is cut at the
 * period's ends, as its bar is; a week must be a week bar of the period. Anything else
 * (another period's month, junk typed into the address bar) reads as the whole period.
 */
function parseDrill(raw: string | null, range: DateRange | null): Drill | null {
  if (!raw || !range) return null;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
    const bar = bucketsFor(range, "month").find((b) => b.key === raw);
    return bar ? { ...bar, kind: "month" } : null;
  }
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(raw);
  if (!m) return null;
  const bar = bucketsFor(range, "week").find((b) => b.from === m[1] && b.to === m[2]);
  return bar ? { ...bar, kind: "week" } : null;
}

/** The period's own dates, for a figure that spans the whole period. All time carries none. */
const periodDates = (period: Period) => ({ from: period.from, to: period.to });

/** The tab named in the link, so Back from a ledger reopens it rather than Spending. */
function tabFromHash(): Tab {
  const hash = window.location.hash;
  if (!hash.startsWith("#/reports")) return "spending";
  const q = hash.indexOf("?");
  const wanted = new URLSearchParams(q < 0 ? "" : hash.slice(q + 1)).get("tab");
  return TABS.find((t) => t === wanted) ?? "spending";
}

/** Group by Merchant when the link says so; Category otherwise. */
function groupFromHash(): ReportGroup {
  const hash = window.location.hash;
  if (!hash.startsWith("#/reports")) return "category";
  const q = hash.indexOf("?");
  return new URLSearchParams(q < 0 ? "" : hash.slice(q + 1)).get("group") === "merchant" ? "merchant" : "category";
}

type Phase = "loading" | "unavailable" | "ready";

interface Loaded {
  /** Prepared once per load. The period is applied after, so changing it never refetches. */
  prepared: NormalizedTxn[];
  accounts: Account[];
  mapping: Record<string, string>;
  renames: RenameMap;
}

/** A chart bar was clicked: open the same ledger its table cell links to. */
function openLedgerFromBar(period: string, specFor: (period: string) => LedgerSpec) {
  window.location.hash = ledgerHref(specFor(period));
}

/** One month on a chart: "Sep 2026", starred when the period cuts it short; the same label on the axis and in the tooltip. */
const monthLabel = (rangeTo: string) => (month: string) => formatMonthShort(month) + (isPartialMonth(month, rangeTo) ? "*" : "");

/** Left over by month: a bar a month, green at zero or above and red below, a click opens the month's ledger. */
function LeftOverChart({ rows, rangeTo, label, specFor }: {
  rows: { period: string; net: number }[];
  rangeTo: string;
  label: string;
  specFor: (period: string) => LedgerSpec;
}) {
  const series = useStable<ChartSeries[]>([{
    id: "net", label: "Left over", role: "actual", mark: "bar", barMaxWidth: 96,
    points: rows.map((r) => ({ x: r.period, cents: r.net, tone: r.net >= 0 ? ("good" as const) : ("bad" as const) })),
  }]);
  const marks = useMemo<ChartMark[]>(() => [{ kind: "hline", cents: 0, role: "actual" }], []);
  const formatX = useMemo(() => monthLabel(rangeTo), [rangeTo]);
  return (
    <ChartBase
      title="Left over by month"
      description={label}
      axis="category"
      series={series}
      marks={marks}
      formatX={formatX}
      legend={false}
      onMarkClick={(m) => openLedgerFromBar(m.x, specFor)}
      height={320}
    />
  );
}

/** Money in and out by month: income and expense bars, expense below zero, and what was left over as a line. */
function CashFlowChart({ rows, rangeTo, label, sideSpec }: {
  rows: { period: string; income: number; expense: number; net: number }[];
  rangeTo: string;
  label: string;
  sideSpec: (month: string, kind: "income" | "expense") => LedgerSpec;
}) {
  const series = useStable<ChartSeries[]>([
      { id: "income", label: "Income", role: "category", colorIndex: 0, mark: "bar", barMaxWidth: 96, points: rows.map((r) => ({ x: r.period, cents: r.income })) },
      { id: "expense", label: "Expense", role: "category", colorIndex: 1, mark: "bar", barMaxWidth: 96, points: rows.map((r) => ({ x: r.period, cents: r.expense })) },
      { id: "net", label: "Left over", role: "actual", mark: "line", showPoints: true, points: rows.map((r) => ({ x: r.period, cents: r.net })) },
  ]);
  const marks = useMemo<ChartMark[]>(() => [{ kind: "hline", cents: 0, role: "actual" }], []);
  const formatX = useMemo(() => monthLabel(rangeTo), [rangeTo]);
  return (
    <ChartBase
      title="Cash flow by month"
      description={label}
      axis="category"
      series={series}
      marks={marks}
      formatX={formatX}
      onMarkClick={(m) => {
        // The line is not a side: only the two bars open a ledger.
        if (m.seriesId === "income" || m.seriesId === "expense") {
          const side = m.seriesId;
          openLedgerFromBar(m.x, (month) => sideSpec(month, side));
        }
      }}
      height={320}
    />
  );
}

export interface ReportsSectionProps {
  dataLayer?: Partial<ReportsDataLayer>;
  /** Overrides the shared period. Tests pin it so none depends on today's date. */
  period?: Period;
  /** Overrides the shared comparison choice, for the same reason. */
  compare?: CompareId;
  /** Overrides the shared choice of budget lines on Spending, for the same reason. */
  categories?: string[];
}

export default function ReportsSection({
  dataLayer,
  period: pinned,
  compare: pinnedCompare,
  categories: pinnedCategories,
}: ReportsSectionProps) {
  const shared = usePeriod();
  const period = pinned ?? shared;
  const sharedCompare = useCompare();
  const compare = pinnedCompare ?? sharedCompare;
  const sharedCategories = useReportCategories();
  const chosen = pinnedCategories ?? sharedCategories;
  const deps = useMemo<ReportsDataLayer>(
    () => ({ ...defaultDataLayer, ...dataLayer }),
    [dataLayer]
  );
  const dbRef = useRef<Db | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [group, setGroup] = useState<ReportGroup>(groupFromHash);
  // The clicked month or week, kept with the period it
  // was clicked under: a new period starts on the whole period again.
  const periodKey = `${period.preset}|${period.from ?? ""}|${period.to ?? ""}`;
  const periodKeyRef = useRef(periodKey);
  periodKeyRef.current = periodKey;
  const [drillState, setDrillState] = useState<{ raw: string | null; periodKey: string }>(() => ({ raw: drillFromHash(), periodKey }));
  const drillRaw = drillState.periodKey === periodKey ? drillState.raw : null;
  useEffect(() => {
    const readTab = () => {
      setTab(tabFromHash());
      setGroup(groupFromHash());
      setDrillState({ raw: drillFromHash(), periodKey: periodKeyRef.current });
    };
    window.addEventListener("hashchange", readTab);
    return () => window.removeEventListener("hashchange", readTab);
  }, []);
  // A new period drops the old drill from the link too, so a reload shows what is on screen.
  useEffect(() => {
    if (drillState.periodKey !== periodKey && drillFromHash() !== null) {
      const q = new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf("?") + 1));
      q.delete("drill");
      window.history.replaceState(null, "", `#/reports?${q.toString()}`);
    }
  }, [drillState.periodKey, periodKey]);
  const changeTab = (next: Tab) => {
    setTab(next);
    // replaceState, not a new history entry: the open tab is part of where you
    // are, not a step to walk back through.
    window.history.replaceState(null, "", backTo(next, period, compare, chosen, group, drillRaw));
  };
  const changeGroup = (next: ReportGroup) => {
    setGroup(next);
    window.history.replaceState(null, "", backTo(tab, period, compare, chosen, next, drillRaw));
  };
  const changeDrill = (next: Drill | null) => {
    const raw = next ? drillText(next) : null;
    setDrillState({ raw, periodKey });
    window.history.replaceState(null, "", backTo(tab, period, compare, chosen, group, raw));
  };

  const reload = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    const [txns, accounts, rules, adjustments, mapping, renames, zelleByMemo] = await Promise.all([
      deps.getTransactions(db),
      deps.getAccounts(db),
      deps.getRules(db),
      deps.getAdjustments(db),
      deps.getCategoryMappings(db),
      // An extra: with no list, every merchant shows the bank's name.
      deps.getMerchantRenames(db).catch(() => [] as MerchantRename[]),
      deps.getZelleMemoNames(db).catch(() => false),
    ]);
    // Prepared HERE, once. rollupMonthly runs classify() upstream, so a
    // category in this rollup is the same category the Budget counts under.
    // Rules read the bank's name; the rename list only names the merchants below.
    const prepared = prepareTransactions(txns, { rules, adjustments, accounts, mapping });
    setLoaded({ prepared, accounts, mapping, renames: renameMap(renames, { zelleByMemo }) });
  }, [deps]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = await deps.loadDb();
        if (cancelled) return;
        dbRef.current = db;
        await reload();
        if (!cancelled) setPhase("ready");
      } catch {
        if (!cancelled) setPhase("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deps, reload]);

  // The period is applied to transactions, by day, BEFORE they roll up into
  // months. A period that ends mid-month therefore yields a short last month,
  // and the ledger links below are cut at the same day so the two still agree.
  const rollups = useMemo<MonthlyRollup[] | null>(
    () =>
      loaded
        ? rollupMonthly(
            loaded.prepared.filter((t) => inPeriod(t.date, period)),
            loaded.accounts,
            loaded.mapping
          )
        : null,
    [loaded, period]
  );
  // Spending and Income read one list of entries each, made once per load; the
  // period is applied by the panel, so changing it never re-classifies anything.
  const sides = useMemo(() => {
    if (!loaded) return null;
    let earliest: string | null = null;
    let latest: string | null = null;
    for (const t of loaded.prepared) {
      const day = t.date.slice(0, 10);
      if (earliest == null || day < earliest) earliest = day;
      if (latest == null || day > latest) latest = day;
    }
    const nameOf = (t: NormalizedTxn) => merchantOf(t, loaded.renames);
    const expense: ReportEntry[] = reportEntries(loaded.prepared, loaded.accounts, loaded.mapping, "expense", nameOf);
    const income: ReportEntry[] = reportEntries(loaded.prepared, loaded.accounts, loaded.mapping, "income", nameOf);
    // Budget lines to narrow to: every spending line in the history, A to Z.
    const options = [...new Set(expense.map((e) => e.category))].sort((a, b) => a.localeCompare(b));
    return { expense, income, earliest, latest, options };
  }, [loaded]);
  const today = periodAsOf();
  // An open-ended period runs to today, or to the newest transaction when one is dated later.
  const range = useMemo(() => {
    if (!sides) return null;
    const end = sides.latest && sides.latest > today ? sides.latest : today;
    return reportRange(period, sides.earliest, end);
  }, [sides, period, today]);
  const cashflow = useMemo(() => (rollups ? cashFlowByMonth(rollups) : null), [rollups]);
  const drill = useMemo(() => parseDrill(drillRaw, range), [drillRaw, range]);
  const shownDrill = drill ? drillText(drill) : null;

  // The comparison, worked out once for all three tabs. `note` explains why there
  // is nothing to compare, in place of columns full of zeros that look like data.
  const comparison = useMemo<{ active: ActiveComparison | null; note: string | null }>(() => {
    if (!loaded || compare === "none") return { active: null, note: null };
    const baseline = baselineFor(period, compare);
    if (!baseline) {
      return {
        active: null,
        note:
          period.preset === "all"
            ? "All time has nothing before it to compare with. Choose a period with a start and an end."
            : "Choose a period with a start and an end to compare.",
      };
    }
    const earliest = loaded.prepared.reduce<string | null>(
      (min, t) => (min == null || t.date < min ? t.date : min),
      null
    );
    if (!baselineHasHistory(baseline, earliest)) {
      const from = baseline.ranges.reduce((min, r) => (r.from < min ? r.from : min), baseline.ranges[0].from);
      const to = baseline.ranges.reduce((max, r) => (r.to > max ? r.to : max), baseline.ranges[0].to);
      const start = earliest ? earliest.slice(0, 10) : null;
      return {
        active: null,
        note: start
          ? `Your history starts ${formatDateRange(start, start)}, which is not far enough back to compare with ${formatDateRange(from, to)}.`
          : "There is no history to compare with yet.",
      };
    }
    const segments = baselineSegments(period, compare);
    return {
      active: {
        label: COMPARE_OPTIONS.find((o) => o.id === compare)?.label ?? "Baseline",
        baseline,
        sums: sumForBaseline(loaded.prepared, loaded.accounts, loaded.mapping, baseline),
        segments,
      },
      note: null,
    };
  }, [loaded, period, compare]);
  const caption = comparison.active
    ? `${formatDateRange(period.from, period.to)} compared with ${comparison.active.baseline.caption}.`
    : comparison.note;

  if (phase === "loading") return <Skeleton className="h-96 w-full" />;
  if (phase === "unavailable") {
    return (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>
          The local server is not reachable. Restart the app.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Tabs value={tab} onValueChange={(v) => changeTab(v as Tab)}>
      <TabsList>
        <TabsTrigger value="spending">Spending</TabsTrigger>
        <TabsTrigger value="income">Income</TabsTrigger>
        <TabsTrigger value="cashflow">Cash flow</TabsTrigger>
        <TabsTrigger value="net">Left over</TabsTrigger>
      </TabsList>

      <TabsContent value="spending" className="pt-4">
        <CategoryPanel
          kind="expense"
          entries={sides?.expense ?? []}
          range={range}
          period={period}
          today={today}
          back={backTo("spending", period, compare, chosen, group, shownDrill)}
          comparison={comparison.active}
          caption={caption}
          chosen={chosen}
          options={sides?.options ?? []}
          onChoose={pickReportCategories}
          group={group}
          onGroup={changeGroup}
          merchantLink={(name, shown) => merchantHref(name, backTo("spending", period, compare, chosen, group, shownDrill), shown)}
          drill={drill}
          onDrill={changeDrill}
        />
      </TabsContent>

      <TabsContent value="income" className="pt-4">
        <CategoryPanel
          kind="income"
          entries={sides?.income ?? []}
          range={range}
          period={period}
          today={today}
          back={backTo("income", period, compare, chosen, group, shownDrill)}
          comparison={comparison.active}
          caption={caption}
          chosen={[]}
          options={[]}
          group={group}
          onGroup={changeGroup}
          merchantLink={(name, shown) => merchantHref(name, backTo("income", period, compare, chosen, group, shownDrill), shown)}
          drill={drill}
          onDrill={changeDrill}
        />
      </TabsContent>

      <TabsContent value="cashflow" className="pt-4">
        <CashFlowPanel data={cashflow} back={backTo("cashflow", period, compare)} period={period} comparison={comparison.active} caption={caption} />
      </TabsContent>

      <TabsContent value="net" className="pt-4">
        <NetPanel data={cashflow} back={backTo("net", period, compare)} period={period} comparison={comparison.active} caption={caption} />
      </TabsContent>
    </Tabs>
  );
}

/**
 * Left over by month, one column each: the cash flow table's last column as a
 * chart. A month above zero stands in the positive color; a month below hangs in
 * the destructive color. Left over is earned minus spent: money moved into or out of
 * savings is not part of it, and the headline names that move in its own sentence.
 *
 * Left over has no side, so a month's ledger lists everything the month counted.
 * Moving money between your own accounts is not counted.
 */
function NetPanel({
  data,
  back,
  period,
  comparison,
  caption,
}: {
  data: MonthTotals[] | null;
  back: string;
  period: Period;
  comparison: ActiveComparison | null;
  caption: string | null;
}) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }
  // The month the period ends inside is marked. An open-ended period runs to today.
  const rangeTo = period.to ?? localDateIso();
  const notePeriods = data.map((m) => m.period);
  const rows = data.map((m) => ({ period: m.period, net: m.netCents }));
  const total = data.reduce((sum, m) => sum + m.netCents, 0);
  const putAway = data.reduce((sum, m) => sum + m.savingCents, 0);
  const above = data.filter((m) => m.netCents >= 0).length;
  const below = data.length - above;
  const months = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;
  const monthSpec = (month: string): LedgerSpec => ({
    label: "Left over",
    back,
    kind: null,
    ...clampToPeriod(monthBounds(month), period),
  });
  const result = (cents: number) => (cents >= 0 ? "above" : "below");
  const leftOverLabel = `Left over by month: ${months(above)} above zero, ${months(below)} below`;
  // A withdrawal is negative saving; say it in words rather than "putting away -$500".
  // Only the amounts take the figure typeface.
  const savingNote =
    putAway > 0 ? (
      <>. Also put <span className={MONEY}>{formatCents(putAway)}</span> into investments.</>
    ) : putAway < 0 ? (
      <>. Also took <span className={MONEY}>{formatCents(-putAway)}</span> out of investments.</>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardDescription>Left over</CardDescription>
          <CardTitle className="text-base">What was left over, per month</CardTitle>
          <p
            data-testid="net-headline"
            className={`text-sm ${total >= 0 ? "text-positive" : "text-destructive"}`}
          >
            Left over <span className={MONEY}>{formatCents(total)}</span> over {formatDateRange(period.from, period.to)}
            {savingNote}
          </p>
        </CardHeader>
        <CardContent>
          <div
            data-testid="net-chart"
            style={{ width: "100%", height: 320 }}
            aria-label={leftOverLabel}
          >
            <LeftOverChart rows={rows} rangeTo={rangeTo} label={leftOverLabel} specFor={monthSpec} />
          </div>
          <PartialMonthNote periods={notePeriods} rangeTo={rangeTo} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="pb-3 text-xs text-muted-foreground">{CLICK_HINT}</p>
          {caption && (
            <p data-testid="compare-caption" className="pb-3 text-sm">
              {caption}
            </p>
          )}
          <div className="overflow-x-auto">
            <table data-testid="net-table" className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2">Month</th>
                  <th className={FIGURE_HEAD}>Left over</th>
                </tr>
              </thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.period} className="border-b last:border-0">
                    <td className="py-1.5">{monthHeading(m.period, rangeTo)}</td>
                    <td
                      data-testid={`net-${m.period}`}
                      data-result={result(m.netCents)}
                      className={`${FIGURE_CELL} ${MONEY} ${m.netCents < 0 ? "text-destructive" : ""}`}
                    >
                      <Figure cents={m.netCents} spec={monthSpec(m.period)} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium">
                  <td className="py-1.5">Total</td>
                  <td
                    data-testid="net-total"
                    data-result={result(total)}
                    className={`${FIGURE_CELL} ${MONEY} ${total < 0 ? "text-destructive" : ""}`}
                  >
                    <Figure cents={total} spec={{ label: "Left over", back, kind: null, ...periodDates(period) }} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {comparison && (
            <div className="overflow-x-auto pt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2"></th>
                    <th className={FIGURE_HEAD}>This period</th>
                    <th className={FIGURE_HEAD}>{comparison.label}</th>
                    <th className={FIGURE_HEAD}>Change</th>
                    <th className={FIGURE_HEAD}>Change %</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1.5">Left over</td>
                    <td data-testid="net-compare-current" className={`${FIGURE_CELL} ${MONEY}`}>
                      {formatCents(total)}
                    </td>
                    <td data-testid="net-compare-baseline" className={`${FIGURE_CELL} ${MONEY} text-muted-foreground`}>
                      {formatCents(comparison.sums.netCents)}
                    </td>
                    <ChangeCells c={compareFigures(total, comparison.sums.netCents, "net")} idSuffix="net" />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * "22%", or an em-dash when there was no income to take a share of. Whole
 * percent: a savings rate quoted to a decimal implies a precision the
 * underlying categorisation does not have.
 */
function formatSavingsRate(rate: number | null): string {
  if (rate === null) return "";
  return `${Math.round(rate * 100)}%`;
}

function CashFlowPanel({
  data,
  back,
  period,
  comparison,
  caption,
}: {
  data: MonthTotals[] | null;
  back: string;
  period: Period;
  comparison: ActiveComparison | null;
  caption: string | null;
}) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }
  // The month the period ends inside is marked. An open-ended period runs to today.
  const rangeTo = period.to ?? localDateIso();
  const notePeriods = data.map((m) => m.period);
  // Expense drawn as a NEGATIVE bar so income and expense read as +/- from a
  // zero baseline. Net line rides across the top of the bars.
  const rows = data.map((m) => ({
    period: m.period,
    income: m.incomeCents,
    expense: -m.expenseCents,
    net: m.netCents,
  }));
  const cashFlowLabel = "Cash flow: income and expense by month, with what was left over";
  // Left over has no side: its ledger lists everything the month counted.
  const SIDE_LABEL = {
    income: "Income",
    expense: "Expense",
    saving: "Saved",
    investment_income: "Investment income",
  } as const;
  const sideSpec = (month: string, kind: "income" | "expense" | "saving" | "investment_income" | null): LedgerSpec => ({
    label: kind ? SIDE_LABEL[kind] : "Left over",
    back,
    kind,
    ...clampToPeriod(monthBounds(month), period),
  });
  // The period as a whole against the baseline as a whole. The per-month table
  // below stays as it is: a baseline per month would be a second table, not a column.
  const current = data.reduce(
    (sum, m) => ({ income: sum.income + m.incomeCents, expense: sum.expense + m.expenseCents, leftOver: sum.leftOver + m.netCents }),
    { income: 0, expense: 0, leftOver: 0 }
  );
  const summaryRows = comparison
    ? ([
        { id: "income", label: "Income", kind: "income", now: current.income, base: comparison.sums.incomeCents },
        { id: "expense", label: "Expense", kind: "expense", now: current.expense, base: comparison.sums.expenseCents },
        // Left over on both sides: the baseline subtracts saving too (compare.ts).
        { id: "net", label: "Left over", kind: "net", now: current.leftOver, base: comparison.sums.netCents },
      ] as const)
    : [];
  const summaryLedger = (kind: "income" | "expense" | "net", label: string, range: { from: string | null; to: string | null }, divideBy?: number): LedgerSpec => ({
    label,
    back,
    kind: kind === "net" ? null : kind,
    ...range,
    divideBy,
  });

  return (
    <div className="flex flex-col gap-4">
      {caption && (
        <Card>
          <CardContent className="p-4">
            <p data-testid="compare-caption" className="pb-3 text-sm">
              {caption}
            </p>
            {comparison && (
              <div className="overflow-x-auto">
                <table data-testid="compare-summary" className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="pb-2"></th>
                      <th className={FIGURE_HEAD}>This period</th>
                      <th className={FIGURE_HEAD}>{comparison.label}</th>
                      <th className={FIGURE_HEAD}>Change</th>
                      <th className={FIGURE_HEAD}>Change %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryRows.map((row) => {
                      const range = comparison.baseline.ledgerRange;
                      // Net is two-sided, and an average needs one side, so an averaged net just shows.
                      const opens = range && !(row.kind === "net" && comparison.baseline.divideBy > 1);
                      return (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="py-1.5">{row.label}</td>
                          <td data-testid={`summary-current-${row.id}`} className={`${FIGURE_CELL} ${MONEY}`}>
                            <Figure cents={row.now} spec={summaryLedger(row.kind, row.label, { from: period.from, to: period.to })} />
                          </td>
                          <td data-testid={`summary-baseline-${row.id}`} className={`${FIGURE_CELL} ${MONEY} text-muted-foreground`}>
                            {opens ? (
                              <Figure
                                cents={row.base}
                                spec={summaryLedger(
                                  row.kind,
                                  `${row.label}, ${comparison.label.toLowerCase()}`,
                                  range,
                                  comparison.baseline.divideBy > 1 ? comparison.baseline.divideBy : undefined
                                )}
                              />
                            ) : (
                              formatCents(row.base)
                            )}
                          </td>
                          <ChangeCells c={compareFigures(row.now, row.base, row.kind)} idPrefix="summary-" idSuffix={row.id} />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardDescription>Cash flow</CardDescription>
          <CardTitle className="text-base">Income vs expense, per month</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: 320 }}>
            <CashFlowChart rows={rows} rangeTo={rangeTo} label={cashFlowLabel} sideSpec={sideSpec} />
          </div>
          <PartialMonthNote periods={notePeriods} rangeTo={rangeTo} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p data-testid="click-hint" className="pb-3 text-xs text-muted-foreground">{CLICK_HINT}</p>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="pb-2">Month</th>
                <th className={FIGURE_HEAD}>Income</th>
                <th className={FIGURE_HEAD} title="What your money earned, kept apart from what you earned">
                  Investment income
                </th>
                <th className={FIGURE_HEAD}>Expense</th>
                <th className={FIGURE_HEAD} title="Money put away. Negative in a month you took more out than you put in.">
                  Saved
                </th>
                <th className={FIGURE_HEAD} title="Share of everything that came in that you put away">
                  Saved %
                </th>
                <th className={FIGURE_HEAD} title="Income, less spending, less what you put away">
                  Left over
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.period} data-testid={`cashflow-${m.period}`} className="border-b last:border-0">
                  <td className="py-1.5">{monthHeading(m.period, rangeTo)}</td>
                  <td data-testid={`cashflow-${m.period}-income`} className={`${FIGURE_CELL} ${MONEY}`}>
                    <Figure cents={m.incomeCents} spec={sideSpec(m.period, "income")} />
                  </td>
                  <td
                    data-testid={`cashflow-${m.period}-investment-income`}
                    className={`${FIGURE_CELL} ${MONEY}`}
                  >
                    <Figure cents={m.investmentIncomeCents} spec={sideSpec(m.period, "investment_income")} />
                  </td>
                  <td
                    data-testid={`cashflow-${m.period}-expense`}
                    className={`${FIGURE_CELL} ${MONEY}`}
                  >
                    <Figure cents={m.expenseCents} spec={sideSpec(m.period, "expense")} />
                  </td>
                  <td data-testid={`cashflow-${m.period}-saving`} className={`${FIGURE_CELL} ${MONEY}`}>
                    <Figure cents={m.savingCents} spec={sideSpec(m.period, "saving")} />
                  </td>
                  <td
                    data-testid={`cashflow-${m.period}-savings-rate`}
                    className={`${FIGURE_CELL} ${MONEY} text-muted-foreground`}
                  >
                    {formatSavingsRate(savingsRate(m))}
                  </td>
                  <td
                    data-testid={`cashflow-${m.period}-left-over`}
                    className={`${FIGURE_CELL} font-medium ${MONEY} ${
                      m.netCents < 0 ? "text-destructive" : ""
                    }`}
                  >
                    <Figure cents={m.netCents} spec={sideSpec(m.period, null)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
