// src/ui/Charts.tsx
//
// Monthly cash-flow and cumulative-projected-surplus charts derived from `buildForecast`'s
// ForecastResult, drawn through the shared chart base (src/ui/charts). No registry block fits: the
// chart blocks are Recharts, the two-series ones are Pro-gated, and none is built on ECharts.
//
// Same injectable-data-layer / try-catch-around-the-load pattern as
// BudgetGrid.tsx: App.tsx uses the real src/ui/lib/db.ts functions (the
// default), tests inject stubs, and headless `vite build`/`vite preview`
// with no server behind /api render a neutral empty/not-connected state
// instead of crashing.
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  loadDb,
  getTransactionsUI,
  getAccountsUI,
  getCategoryMappingsUI,
  getPlanUI,
  getBudgetLinesUI,
  getBudgetExtrasUI,
  getTransactionAdjustmentsUI,
  getSalarySettingsUI,
  getMaaserMarksUI,
  type Db,
} from "./lib/db";
import type { NormalizedTxn, Account } from "../domain/types";
import type { Plan, BudgetLine, ForecastResult } from "../domain/plan-types";
import type { TransactionAdjustment } from "../domain/adjustments";
import { prepareForRollup } from "../domain/pipeline";
import { rollupMonthly } from "../domain/rollups";
import { buildForecast } from "../domain/forecast";
import { formatCents } from "../domain/money";
import { maaserLedger, type MaaserLedger } from "../domain/maaser-pot";
import type { MaaserMark } from "../domain/maaser-marks";
import { potIsOn } from "../domain/charity-pot";
import { buildPayFlow } from "../domain/sankey";
import { currentSalaryBreakdown, hasFirmTaxes, type SalaryAssumptions, type SalaryBreakdown } from "../domain/salary";
import { taxSetUpNeeded } from "../domain/tax";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import ChartBase from "./charts/ChartBase";
import SankeyChart from "./charts/SankeyChart";
import { ledgerSpecForFlowNode } from "./charts/click-through";
import { useStable } from "./charts/useStable";
import type { ChartMark, ChartSeries } from "./charts/types";
import { formatMonthShort, localDateIso, monthBounds } from "../domain/period";
import { ledgerHref } from "./lib/ledger-link";

// ---------------------------------------------------------------------------
// Injectable data layer (mirrors BudgetGrid.tsx's BudgetGridDataLayer)
// ---------------------------------------------------------------------------

export interface ChartsDataLayer {
  loadDb: () => Promise<Db>;
  getTransactions: (db: Db) => Promise<NormalizedTxn[]>;
  getAccounts: (db: Db) => Promise<Account[]>;
  getCategoryMappings: (db: Db) => Promise<Record<string, string>>;
  getPlan: (db: Db, id: string) => Promise<Plan | null>;
  getBudgetLines: (db: Db, planId: string) => Promise<BudgetLine[]>;
  getBudgetExtras: typeof getBudgetExtrasUI;
  getTransactionAdjustments: (db: Db) => Promise<TransactionAdjustment[]>;
  /** For the Sankey only: the salary and charity pot settings, and the pot's marks. A failure leaves the paycheck view and the pot band off. */
  getSalarySettings: (db: Db) => Promise<SalaryAssumptions>;
  getMaaserMarks: (db: Db) => Promise<MaaserMark[]>;
}

const defaultDataLayer: ChartsDataLayer = {
  loadDb,
  getTransactions: getTransactionsUI,
  getAccounts: getAccountsUI,
  getCategoryMappings: getCategoryMappingsUI,
  getPlan: getPlanUI,
  getBudgetLines: getBudgetLinesUI,
  getBudgetExtras: getBudgetExtrasUI,
  getTransactionAdjustments: getTransactionAdjustmentsUI,
  getSalarySettings: getSalarySettingsUI,
  getMaaserMarks: getMaaserMarksUI,
};

export interface ChartsProps {
  /** Override any subset of the data layer (tests inject stubs; App.tsx uses the default). */
  dataLayer?: Partial<ChartsDataLayer>;
  /** ISO date used to split "elapsed" (actuals) from "future" (plan) months. Defaults to today. */
  asOfDate?: string;
  /**
   * Plan to chart -- App.tsx passes its shared selected-plan state here (the same id
   * BudgetGrid is showing/editing). null/undefined means no plan is selected yet
   * (e.g. no plans exist), which renders the "no data" empty state rather than
   * looking up a plan id.
   */
  planId?: string | null;
}

// ---------------------------------------------------------------------------
// Chart data shaping over ForecastResult
// ---------------------------------------------------------------------------

/** Chart months read "Sep 2026", the same as every other screen. */
const formatMonthLabel = formatMonthShort;

interface CashFlowPoint {
  period: string;
  label: string;
  incomeCents: number;
  expenseCents: number;
}

interface SurplusPoint {
  period: string;
  label: string;
  cumulativeCents: number;
}

// Monthly cash flow: forecast income vs. expense per month, summed from
// ForecastResult.months[i].cells (each cell is one planning category x kind
// for that month; forecastCents blends actual-through-asOf with plan for
// the remainder, same value the budget grid's Forecast column shows).
function buildCashFlowData(forecast: ForecastResult): CashFlowPoint[] {
  return forecast.months.map((m) => {
    let incomeCents = 0;
    let expenseCents = 0;
    for (const c of m.cells) {
      if (c.kind === "income") incomeCents += c.forecastCents;
      else expenseCents += c.forecastCents;
    }
    return { period: m.period, label: formatMonthLabel(m.period), incomeCents, expenseCents };
  });
}

// Cumulative projected surplus: ForecastResult.totals.cumulativeSurplus is
// already the running total across the plan's months; just relabel for the chart.
function buildSurplusData(forecast: ForecastResult): SurplusPoint[] {
  return forecast.totals.cumulativeSurplus.map((p) => ({
    period: p.period,
    label: formatMonthLabel(p.period),
    cumulativeCents: p.cents,
  }));
}

const ZERO_LINE: ChartMark[] = [{ kind: "hline", cents: 0, role: "neutral" }];

/** The two month charts share one axis and one screen, so a hover on one moves the other's crosshair. */
const LINK_GROUP = "plan-months";

/** What the Sankey draws from: everything buildPayFlow reads, loaded once with the charts. */
interface SankeyData {
  prepared: NormalizedTxn[];
  accounts: Account[];
  mapping: Record<string, string>;
  salary: SalaryAssumptions | null;
  marks: MaaserMark[];
}

type SankeySpan = "month" | "year";
type SankeyView = "bank" | "paycheck";

/** The household's paycheck figures, or why there are none. Only a yearly base salary has a gross to draw. */
function paycheckOf(salary: SalaryAssumptions | null): { breakdown: SalaryBreakdown | null; note: string | null } {
  const current = salary?.currentSalary ?? null;
  if (!salary || !current || current.kind !== "gross") return { breakdown: null, note: "Fill in Salary settings to add the full paycheck" };
  const typed = hasFirmTaxes(salary.firmTaxes) && salary.firmTaxes?.federalAnnualCents != null && salary.firmTaxes?.payrollAnnualCents != null;
  if (!typed && taxSetUpNeeded(salary)) return { breakdown: null, note: "Finish your tax set-up in Settings to add the full paycheck" };
  return { breakdown: currentSalaryBreakdown(current.grossAnnualCents, 0, salary), note: null };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Phase = "loading" | "unavailable" | "no-data" | "ready" | "error";

export default function Charts({ dataLayer, asOfDate, planId }: ChartsProps) {
  const deps = useMemo<ChartsDataLayer>(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);
  const effectiveAsOfDate = asOfDate ?? localDateIso();
  const effectivePlanId = planId ?? null;

  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [sankeyData, setSankeyData] = useState<SankeyData | null>(null);
  const [span, setSpan] = useState<SankeySpan>("month");
  const [flowView, setFlowView] = useState<SankeyView>("bank");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let db: Db;
      try {
        db = await deps.loadDb();
      } catch {
        // Expected when the local Node server is unreachable (headless build / preview).
        if (!cancelled) setPhase("unavailable");
        return;
      }

      if (!effectivePlanId) {
        // No plan selected yet (e.g. zero plans exist) -- nothing to chart.
        if (!cancelled) setPhase("no-data");
        return;
      }

      try {
        const [txns, accounts, mapping, plan, budgetLines, adjustments, extras] = await Promise.all([
          deps.getTransactions(db),
          deps.getAccounts(db),
          deps.getCategoryMappings(db),
          deps.getPlan(db, effectivePlanId),
          deps.getBudgetLines(db, effectivePlanId),
          deps.getTransactionAdjustments(db),
          deps.getBudgetExtras(db, effectivePlanId),
        ]);
        if (cancelled) return;

        if (!plan) {
          setPhase("no-data");
          return;
        }

        // Neutralize app-owned data-quality adjustments (e.g. a recurring
        // miscoded transfer) before rolling up, same as BudgetGrid.tsx and
        // the seed service -- so the charted income/expense stays consistent
        // with every other rollup site in the app.
        const prepared = prepareForRollup(txns, adjustments, accounts, mapping);
        const rollups = rollupMonthly(prepared, accounts, mapping);
        const result = buildForecast(plan, budgetLines, rollups, effectiveAsOfDate, [], extras.bigMonths);
        // The Sankey's extras are optional: with no salary or pot settings it still draws from the bank rows.
        const [salary, marks] = await Promise.all([
          deps.getSalarySettings(db).catch(() => null),
          deps.getMaaserMarks(db).catch(() => [] as MaaserMark[]),
        ]);
        if (cancelled) return;
        setSankeyData({ prepared, accounts, mapping, salary, marks });
        setForecast(result);
        setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setErrorMessage(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // effectiveAsOfDate/deps only meaningfully change identity across remounts
    // in this app; re-running on every render would refetch needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePlanId]);

  const cashFlowData = useMemo(() => (forecast ? buildCashFlowData(forecast) : []), [forecast]);
  const surplusData = useMemo(() => (forecast ? buildSurplusData(forecast) : []), [forecast]);

  const cashFlowSeries = useMemo<ChartSeries[]>(
    () => [
      { id: "income", label: "Income", role: "category", colorIndex: 0, mark: "bar", points: cashFlowData.map((d) => ({ x: d.period, cents: d.incomeCents })) },
      { id: "expense", label: "Expense", role: "category", colorIndex: 1, mark: "bar", points: cashFlowData.map((d) => ({ x: d.period, cents: d.expenseCents })) },
    ],
    [cashFlowData],
  );
  const surplusSeries = useMemo<ChartSeries[]>(
    () => [{ id: "surplus", label: "Running total, left over", role: "actual", mark: "line", points: surplusData.map((d) => ({ x: d.period, cents: d.cumulativeCents })) }],
    [surplusData],
  );
  const cashFlowDescription = useMemo(() => {
    const income = cashFlowData.reduce((n, d) => n + d.incomeCents, 0);
    const expense = cashFlowData.reduce((n, d) => n + d.expenseCents, 0);
    return `Forecast income of ${formatCents(income)} and expense of ${formatCents(expense)} across ${cashFlowData.length} months.`;
  }, [cashFlowData]);
  const surplusDescription = useMemo(() => {
    const last = surplusData[surplusData.length - 1];
    return last ? `The running total of forecast surplus reaches ${formatCents(last.cumulativeCents)} by ${last.label}.` : "No months to show.";
  }, [surplusData]);

  const asOfMonth = effectiveAsOfDate.slice(0, 7);
  const from = span === "month" ? asOfMonth : `${asOfMonth.slice(0, 4)}-01`;
  const paycheck = useMemo(() => paycheckOf(sankeyData?.salary ?? null), [sankeyData]);
  const showPaycheck = flowView === "paycheck" && paycheck.breakdown !== null;
  const builtFlow = useMemo(() => {
    if (!sankeyData) return null;
    const { prepared, accounts, mapping, salary, marks } = sankeyData;
    const pot = salary?.pot && potIsOn(salary.pot) ? salary.pot : null;
    const potLedger: MaaserLedger | null = pot
      ? maaserLedger({ prepared, accounts, mapping, marks, maaserRate: salary?.maaserRate ?? 0, pot, from: monthBounds(from).from, to: monthBounds(asOfMonth).to, availableCents: null })
      : null;
    return buildPayFlow({ prepared, accounts, mapping, from, to: asOfMonth, pot, potLedger, paycheck: paycheck.breakdown, showPaycheck });
  }, [sankeyData, from, asOfMonth, paycheck, showPaycheck]);
  // The same flow object while its content is unchanged, so the chart is not redrawn (and moved) by a re-render.
  const flow = useStable(builtFlow);
  const openBand = useCallback(
    (id: string) => {
      const node = flow?.nodes.find((n) => n.id === id);
      if (!flow || !node) return;
      const spec = ledgerSpecForFlowNode(node, flow.from, flow.to, "#/budget/charts");
      if (spec) window.location.hash = ledgerHref(spec);
    },
    [flow],
  );
  const openMonth = useCallback((m: { seriesId: string; x: string }) => {
    const { from: f, to: t } = monthBounds(m.x);
    const kind = m.seriesId === "income" ? "income" : "expense";
    window.location.hash = ledgerHref({ label: `${kind === "income" ? "Income" : "Spending"}, ${formatMonthLabel(m.x)}`, back: "#/budget/charts", kind, from: f, to: t });
  }, []);

  if (phase === "loading") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-80 w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    );
  }

  if (phase === "unavailable") {
    return (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>
          No local database connection. The local server is not reachable. Restart the app.
        </AlertDescription>
      </Alert>
    );
  }

  if (phase === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load charts</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
    );
  }

  if (phase === "no-data" || !forecast || cashFlowData.length === 0) {
    return (
      <Alert>
        <AlertTitle>No data yet</AlertTitle>
        <AlertDescription>Create a plan and budget lines to see cash flow charts.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Monthly cash flow</CardTitle>
          <CardDescription>Forecast income vs. expense per month</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartBase
            title="Monthly cash flow"
            description={cashFlowDescription}
            axis="category"
            series={cashFlowSeries}
            formatX={formatMonthLabel}
            zoom
            linkGroup={LINK_GROUP}
            onMarkClick={openMonth}
            height={288}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Running total, left over</CardTitle>
          <CardDescription>Running total of forecast surplus across the plan</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartBase
            title="Running total, left over"
            description={surplusDescription}
            axis="time"
            series={surplusSeries}
            marks={ZERO_LINE}
            formatX={formatMonthLabel}
            zoom
            linkGroup={LINK_GROUP}
            height={288}
          />
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Where pay goes</CardTitle>
          <CardDescription>
            Where the money that reached your bank went. Click a spending, income or Saving band to see its transactions.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup
              value={[span]}
              onValueChange={(v) => v.length > 0 && setSpan(v[0] as SankeySpan)}
              aria-label="Period for where pay goes"
            >
              <ToggleGroupItem value="month">Month</ToggleGroupItem>
              <ToggleGroupItem value="year">Year</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              value={[showPaycheck ? "paycheck" : "bank"]}
              onValueChange={(v) => v.length > 0 && setFlowView(v[0] as SankeyView)}
              aria-label="What to draw"
            >
              <ToggleGroupItem value="bank">Bank money</ToggleGroupItem>
              <ToggleGroupItem value="paycheck" disabled={paycheck.breakdown === null}>Full paycheck</ToggleGroupItem>
            </ToggleGroup>
            {paycheck.note && <span className="text-xs text-muted-foreground">{paycheck.note}</span>}
          </div>
          {flow && flow.links.length > 0 ? (
            <SankeyChart flow={flow} view={showPaycheck ? "paycheck" : "bank"} onNodeClick={openBand} />
          ) : (
            <p className="text-sm text-muted-foreground">No money moved in this period.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
