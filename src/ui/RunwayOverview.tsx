// src/ui/RunwayOverview.tsx
//
// The Forecast screen: how long Drawable lasts, projected from real income against real costs.
// The projection is `cashForecast` (src/domain/cash-forecast.ts): the salary and any additional
// salary from Settings, Salary, the budget's costs, and under a what-if its salary, additional salary
// and costs. A small "If no money came in" line keeps the no-income runway as a safety figure.
//
// It is a presentation layer over three domain pieces:
//   - `drawableLiquidCents(accounts, balances)` (src/domain/runway.ts): starting liquid cash across
//     checking, savings and brokerage plus credit-card balances.
//   - the future months' net, projected RUNWAY_HORIZON_MONTHS out from the as-of date, independent
//     of any plan's end date. The Wish List never reaches it (its items are one-time); a known
//     one-time cost is a What if change.
//   - `computeRunway(startingLiquidCents, futureMonthlyNet)` (src/domain/runway.ts): walks the
//     projection's future months and reports the month it first crosses zero, if any.
// No domain math is reimplemented here; this file only shapes data for those functions and renders
// their results.
//
// The headline and figure tiles are composed from the already-installed card primitive: the
// registries' stat blocks are marketing-page sections, the wrong size for one in-app figure. The line
// chart is drawn by the shared chart base (src/ui/charts) with a dashed zero line in red.
//
// Two-effect data flow, mirroring WishlistSection.tsx's items/forecast split:
//  1. Balances effect (plan-independent): load db, accounts, and account
//      balances; compute drawableLiquidCents. This is what the "no balances
//      synced" empty state guards.
//   2. Projection effect (depends on the resolved plan + starting liquid):
//      load the plan, budget lines, and wishlist items; project the future
//      24 months' net via projectFutureNet; compute the runway. No actuals
//      (transactions/category mappings) are needed here -- the projection
//      is entirely defaults/overrides + planned events. This is what the
//      "no plan selected" state guards.
// Same try/catch-around-the-load pattern as every other section, so
// headless `vite build`/`vite preview` with no server behind /api render a
// neutral "not connected" state instead of crashing.
import { useEffect, useMemo, useState } from "react";

import {
  loadDb,
  getAccountsUI,
  getAccountBalancesUI,
  getPlanUI,
  getBudgetLinesUI,
  getBudgetExtrasUI,
  listPlansUI,
  type Db,
} from "./lib/db";
import type { Account } from "../domain/types";
import type { Plan, BudgetLine, AccountBalance, RunwayResult } from "../domain/plan-types";
import { drawableLiquidCents, computeRunway } from "../domain/runway";
import { RUNWAY_HORIZON_MONTHS } from "../domain/runway-projection";
import { addMonths, applyScenarioToLines, scenarioOverlays, type Scenario } from "../domain/scenario";
import { linesAcrossPlans } from "../domain/plans-across";
import { type WhatIf } from "../domain/what-if";
import { cashForecast, forecastEarners, type ForecastEarners } from "../domain/cash-forecast";
import type { Goal } from "../domain/plan-types";
import { DEFAULT_SALARY_ASSUMPTIONS, type SalaryAssumptions } from "../domain/salary";
import { formatCents } from "../domain/money";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import ChartBase from "./charts/ChartBase";
import type { ChartMark, ChartSeries } from "./charts/types";
import { formatMonthShort, localDateIso } from "../domain/period";

// ---------------------------------------------------------------------------
// Injectable data layer (mirrors Charts.tsx's ChartsDataLayer / WishlistSection.tsx's WishlistDataLayer)
// ---------------------------------------------------------------------------

export interface RunwayDataLayer {
  loadDb: () => Promise<Db>;
  getAccounts: (db: Db) => Promise<Account[]>;
  getAccountBalances: (db: Db) => Promise<AccountBalance[]>;
  getPlan: (db: Db, id: string) => Promise<Plan | null>;
  getBudgetLines: (db: Db, planId: string) => Promise<BudgetLine[]>;
  getBudgetExtras: typeof getBudgetExtrasUI;
  /** Every plan, so a month past this year reads next year's budget once it exists. */
  listPlans: typeof listPlansUI;
}

const defaultDataLayer: RunwayDataLayer = {
  loadDb,
  getAccounts: getAccountsUI,
  getAccountBalances: getAccountBalancesUI,
  getPlan: getPlanUI,
  getBudgetLines: getBudgetLinesUI,
  getBudgetExtras: getBudgetExtrasUI,
  listPlans: listPlansUI,
};

export interface RunwayOverviewProps {
  /** Override any subset of the data layer (tests inject stubs; App.tsx uses the default). */
  dataLayer?: Partial<RunwayDataLayer>;
  /**
   * Plan to project -- App.tsx passes its shared selected-plan state here
   * (the same id BudgetGrid/Charts/WishlistSection use). null/undefined
   * means no plan is selected yet, which renders a "select a plan" hint
   * instead of a runway/chart.
   */
  planId?: string | null;
  /** ISO date used as projectFutureNet's asOfDate and the future-months cutoff. Defaults to today. */
  asOfDate?: string;
  /**
   * The scenario laid over the plan, if any: the same one the top bar reads, so the bar and this
   * screen show the same runway.
   */
  scenario?: Scenario | null;
  /**
   * The what-if behind `scenario`, when it is one. It is composed again here over the budget this
   * screen just read, so a budget edit made after the app loaded is not met with a stale difference.
   */
  whatIf?: WhatIf | null;
  /** The goals, so a switched-on goal cost row counts under a what-if. */
  goals?: Goal[];
  /** Settings, Salary, for composing the what-if. Defaults when not given. */
  salaryAssumptions?: SalaryAssumptions;
}

type BalancesPhase = "loading" | "unavailable" | "empty" | "ready" | "error";
type ForecastPhase = "no-plan" | "loading" | "ready" | "error";

function todayIso(): string {
  return localDateIso();
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatPeriodLong(period: string): string {
  const [y, m] = period.split("-");
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${MONTH_NAMES[idx]} ${y}` : period;
}

/** Chart months read "Sep 2026", the same as every other screen. */
const formatPeriodShort = formatMonthShort;

interface LiquidPoint {
  period: string;
  label: string;
  cents: number;
}

// Exported so a test can assert the chart is given the full projected series.
export function buildLiquidData(runway: RunwayResult): LiquidPoint[] {
  return runway.liquidByMonth.map((m) => ({ period: m.period, label: formatPeriodShort(m.period), cents: m.cents }));
}

const ZERO_LINE: ChartMark[] = [{ kind: "hline", cents: 0, role: "bad", dash: true }];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Where the forecast's money in comes from, for the line under the heading. */
interface IncomeNote {
  /** Nothing is coming in at all: no salary of any kind and no income line. */
  none: boolean;
  /** Money in once every salary has started (the last month that starts one, or the first month). */
  monthlyCents: number;
  fromPeriod: string;
  source: string;
}

function incomeNote(earners: ForecastEarners, months: { period: string; incomeCents: number }[], whatIfSalary: boolean): IncomeNote {
  const starts = [earners.main?.fromPeriod, earners.other?.fromPeriod].filter((p): p is string => !!p);
  const first = months[0]?.period ?? "";
  const last = months[months.length - 1]?.period ?? first;
  const latest = starts.reduce((m, p) => (p > m ? p : m), first);
  const at = latest > last ? last : latest;
  const month = months.find((m) => m.period === at) ?? months[0];
  const parts = [earners.main ? (whatIfSalary ? "this what-if's salary" : "your current salary") : null, earners.other ? "the additional salary" : null].filter(Boolean);
  return {
    none: months.every((m) => m.incomeCents === 0),
    monthlyCents: month?.incomeCents ?? 0,
    fromPeriod: at,
    source: parts.length > 0 ? parts.join(" and ") : "the budget's income lines",
  };
}

/** A stable empty list, so the load effect does not rerun every render. */
const NO_GOALS: Goal[] = [];

export default function RunwayOverview({ dataLayer, planId, asOfDate, scenario = null, whatIf = null, goals = NO_GOALS, salaryAssumptions = DEFAULT_SALARY_ASSUMPTIONS }: RunwayOverviewProps) {
  const deps = useMemo<RunwayDataLayer>(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);
  const effectivePlanId = planId ?? null;
  const effectiveAsOfDate = asOfDate ?? todayIso();
  const asOfMonth = effectiveAsOfDate.slice(0, 7);

  const [db, setDb] = useState<Db | null>(null);
  const [balancesPhase, setBalancesPhase] = useState<BalancesPhase>("loading");
  const [balancesError, setBalancesError] = useState<string | null>(null);
  const [startingLiquidCents, setStartingLiquidCents] = useState(0);

  const [forecastPhase, setForecastPhase] = useState<ForecastPhase>("no-plan");
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [runway, setRunway] = useState<RunwayResult | null>(null);
  // The same costs with no money coming in, for the small
  // "If no money came in" line that stays on the screen as a safety figure.
  const [safety, setSafety] = useState<RunwayResult | null>(null);
  // What comes in, for the line that says where the income is from.
  const [income, setIncome] = useState<IncomeNote | null>(null);

  // Effect 1: db + accounts + account balances -> drawableLiquidCents. Plan-
  // independent, exactly like WishlistSection's item-list effect.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      let handle: Db;
      try {
        handle = await deps.loadDb();
      } catch {
        // Expected when the local Node server is unreachable (headless build / preview).
        if (!cancelled) setBalancesPhase("unavailable");
        return;
      }
      if (cancelled) return;
      setDb(handle);

      try {
        const [accounts, balances] = await Promise.all([
          deps.getAccounts(handle),
          deps.getAccountBalances(handle),
        ]);
        if (cancelled) return;
        setStartingLiquidCents(drawableLiquidCents(accounts, balances));
        setBalancesPhase(balances.length === 0 ? "empty" : "ready");
      } catch (e) {
        if (!cancelled) {
          setBalancesError(e instanceof Error ? e.message : String(e));
          setBalancesPhase("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Data layer only meaningfully changes identity across remounts in this app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect 2: projectFutureNet + computeRunway. Depends on the db handle,
  // the resolved starting liquid figure, and the selected plan. Projects
  // RUNWAY_HORIZON_MONTHS (24) months out from asOfDate using budget
  // defaults/overrides -- independent of the plan's own endDate, so the
  // runway reaches the real cash-out month instead of stopping at the
  // plan's last month. No actuals are needed for a *future* projection, so
  // this effect only loads the budget lines (the Wish List is one-time items
  // and never reaches the runway) -- no transactions, category mappings or rollups are read.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!db || balancesPhase === "loading" || balancesPhase === "unavailable" || balancesPhase === "error") return;
      if (!effectivePlanId) {
        if (!cancelled) {
          setForecastPhase("no-plan");
          setRunway(null);
        }
        return;
      }

      setForecastPhase("loading");
      try {
        const plan = await deps.getPlan(db, effectivePlanId);
        if (cancelled) return;
        if (!plan) {
          setForecastPhase("no-plan");
          setRunway(null);
          return;
        }

        // With more than one plan, each future month reads its
        // own year's plan (linesAcrossPlans). With one plan, that plan is read as it is. A plan
        // list that cannot be read falls back to the one plan.
        const plans = await deps.listPlans(db).catch(() => [plan]);
        const others = plans.length > 1 ? plans : [plan];
        const reads = await Promise.all(others.map((p) => Promise.all([deps.getBudgetLines(db, p.id), deps.getBudgetExtras(db, p.id)])));
        if (cancelled) return;
        const horizon = Array.from({ length: RUNWAY_HORIZON_MONTHS }, (_, i) => addMonths(effectiveAsOfDate.slice(0, 7), i + 1));
        const own = reads[others.findIndex((p) => p.id === plan.id)] ?? reads[0];
        const budgetLines = others.length > 1 ? linesAcrossPlans(others, new Map(others.map((p, i) => [p.id, reads[i][0]])), horizon) : own[0];
        const extras = { ...own[1], bigMonths: reads.flatMap((r) => r[1].bigMonths) };

        // Real income from Settings,
        // Salary against the budget's costs; a what-if moves the salary, the
        // additional salary and the costs (src/domain/cash-forecast.ts). An older
        // scenario that is not a what-if still lays its changes over the lines.
        const activeWhatIf = scenario && whatIf && whatIf.scenarioId === scenario.id ? whatIf : null;
        const periods = Array.from({ length: RUNWAY_HORIZON_MONTHS }, (_, i) => addMonths(effectiveAsOfDate.slice(0, 7), i + 1));
        const lines = !activeWhatIf && scenarioOverlays(scenario) ? applyScenarioToLines(budgetLines, scenario, periods) : budgetLines;
        // Planned big months are on the real budget, so they are paid under Real numbers and under a what-if alike.
        const input = { budgetLines: lines, asOfDate: effectiveAsOfDate, assumptions: salaryAssumptions, whatIf: activeWhatIf, goals, bigMonths: extras.bigMonths };
        const months = cashForecast(input);
        const result = computeRunway(startingLiquidCents, months);
        const withoutIncome = computeRunway(startingLiquidCents, cashForecast({ ...input, noIncome: true }));
        const earners = forecastEarners(salaryAssumptions, activeWhatIf, addMonths(effectiveAsOfDate.slice(0, 7), 1));
        if (cancelled) return;
        setRunway(result);
        setSafety(withoutIncome);
        setIncome(incomeNote(earners, months, !!activeWhatIf && activeWhatIf.salaryGrossAnnualCents !== null));
        setForecastPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setForecastError(e instanceof Error ? e.message : String(e));
          setForecastPhase("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, balancesPhase, effectivePlanId, effectiveAsOfDate, startingLiquidCents, deps, scenario, whatIf, goals, salaryAssumptions]);

  const liquidData = useMemo(() => (runway ? buildLiquidData(runway) : []), [runway]);
  const liquidSeries = useMemo<ChartSeries[]>(
    () => [{ id: "drawable", label: "Drawable", role: "actual", mark: "line", points: liquidData.map((d) => ({ x: d.period, cents: d.cents })) }],
    [liquidData],
  );
  const liquidDescription = useMemo(() => {
    const first = liquidData[0];
    const last = liquidData[liquidData.length - 1];
    return first && last
      ? `Projected Drawable runs from ${formatCents(first.cents)} in ${first.label} to ${formatCents(last.cents)} in ${last.label}.`
      : "No future months to chart.";
  }, [liquidData]);
  const avgMonthlyNetCents = useMemo(() => {
    if (!runway || runway.liquidByMonth.length === 0) return null;
    const netCents =
      runway.liquidByMonth[runway.liquidByMonth.length - 1].cents - runway.startingLiquidCents;
    return Math.round(netCents / runway.liquidByMonth.length);
  }, [runway]);

  if (balancesPhase === "loading") {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  if (balancesPhase === "unavailable") {
    return (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>
          No local database connection. The local server is not reachable. Restart the app.
        </AlertDescription>
      </Alert>
    );
  }

  if (balancesPhase === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load account balances</AlertTitle>
        <AlertDescription>{balancesError}</AlertDescription>
      </Alert>
    );
  }

  if (balancesPhase === "empty") {
    return (
      <Alert>
        <AlertTitle>No account balances synced yet</AlertTitle>
        <AlertDescription>
          Sync account balances to compute Drawable and project a runway.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-base font-semibold">Forecast</h2>
        <p className="text-sm text-muted-foreground">
          Where your cash is heading: your income from Settings, Salary against the budget's costs, month by month from today's Drawable.
        </p>
        {scenarioOverlays(scenario) && (
          <p className="mt-1 text-sm text-primary" data-testid="runway-overlay">
            Under {scenario!.name}: modeled, not recorded.
          </p>
        )}
        {forecastPhase === "ready" && income && (
          <p data-testid="forecast-income" className="mt-1 text-sm text-muted-foreground">
            {income.none ? (
              <>No current salary is set, so nothing comes in. Add it under Settings, Salary.</>
            ) : (
              <>
                Money in: <span className="font-mono tabular-nums">{formatCents(income.monthlyCents)} a month</span> from {formatPeriodLong(income.fromPeriod)}, from {income.source}.
              </>
            )}
          </p>
        )}
        {/* The safety figure: small, under the heading, not a card. */}
        {forecastPhase === "ready" && safety && (
          <p data-testid="forecast-safety" className="mt-1 text-xs text-muted-foreground">
            {safety.runwayMonths === null
              ? `If no money came in, it would last more than ${RUNWAY_HORIZON_MONTHS} months.`
              : `If no money came in, it would last ${safety.runwayMonths} month${safety.runwayMonths === 1 ? "" : "s"}.`}
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Drawable</CardDescription>
            <CardTitle className="font-mono text-2xl tabular-nums">
              {formatCents(startingLiquidCents)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Balances of the accounts that count as cash you can draw on, less every card balance. Settings, Accounts decides which count.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Runway</CardDescription>
            {forecastPhase === "loading" ? (
              <Skeleton className="h-8 w-32" />
            ) : forecastPhase === "no-plan" ? (
              <CardTitle className="text-lg font-medium text-muted-foreground">
                Select a plan
              </CardTitle>
            ) : forecastPhase === "error" ? (
              <CardTitle className="text-lg font-medium text-muted-foreground">
                Unable to compute
              </CardTitle>
            ) : runway && runway.crossZeroPeriod !== null ? (
              <CardTitle className="font-mono text-2xl tabular-nums">
                {runway.runwayMonths} month{runway.runwayMonths === 1 ? "" : "s"}
              </CardTitle>
            ) : avgMonthlyNetCents !== null && avgMonthlyNetCents >= 0 ? (
              <CardTitle className="text-lg font-medium text-positive">
                Cash-flow positive
              </CardTitle>
            ) : (
              // Still shrinking, just not to zero inside the window, so it is not "Cash-flow positive".
              <CardTitle className="text-lg font-medium">
                Lasts past {RUNWAY_HORIZON_MONTHS} months
              </CardTitle>
            )}
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {forecastPhase === "no-plan" && "Choose a budget to project the runway from today's Drawable."}
            {forecastPhase === "error" && (forecastError ?? "Couldn't build the forecast.")}
            {forecastPhase === "ready" && runway && runway.crossZeroPeriod !== null && (
              <>
                Crosses zero in {formatPeriodLong(runway.crossZeroPeriod)}
              </>
            )}
            {forecastPhase === "ready" && runway && runway.crossZeroPeriod === null && (
              <>
                {avgMonthlyNetCents !== null && avgMonthlyNetCents >= 0
                  ? `No runway limit found within the ${RUNWAY_HORIZON_MONTHS}-month projection horizon.`
                  : `The balance is still falling, but it does not reach zero within the ${RUNWAY_HORIZON_MONTHS}-month projection.`}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Average monthly change</CardDescription>
            {avgMonthlyNetCents === null ? (
              <CardTitle className="text-lg font-medium text-muted-foreground">--</CardTitle>
            ) : (
              <CardTitle className="font-mono text-2xl tabular-nums">
                {formatCents(avgMonthlyNetCents)}
              </CardTitle>
            )}
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Average change in Drawable per future month: money in less money out.
          </CardContent>
        </Card>
      </div>

      {forecastPhase === "no-plan" && (
        <Alert>
          <AlertTitle>No plan selected</AlertTitle>
          <AlertDescription>
            Choose a budget on the Budget screen to project Drawable over time.
          </AlertDescription>
        </Alert>
      )}

      {forecastPhase === "error" && (
        <Alert variant="destructive">
          <AlertTitle>Couldn't build the forecast</AlertTitle>
          <AlertDescription>{forecastError}</AlertDescription>
        </Alert>
      )}

      {forecastPhase === "ready" && liquidData.length === 0 && (
        <Alert>
          <AlertTitle>No future months to chart</AlertTitle>
          <AlertDescription>
            The {RUNWAY_HORIZON_MONTHS}-month projection from {formatPeriodLong(asOfMonth)} produced no data.
          </AlertDescription>
        </Alert>
      )}

      {forecastPhase === "ready" && liquidData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Drawable over time</CardTitle>
            <CardDescription>Projected Drawable, month by month, against a zero line</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartBase
              title="Drawable over time"
              description={liquidDescription}
              axis="time"
              series={liquidSeries}
              marks={ZERO_LINE}
              zoom
              formatX={formatPeriodShort}
              legend={false}
              height={288}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
