// src/ui/NetWorthSection.tsx
//
// Net worth today and over time, one rule for both.
//
// The line is drawn from the balance readings each sync stores: a point per day the banks were
// read, each account's latest reading by then, so the last point is the headline. Days before the
// first reading are left off: working them back from transactions could not be made reliable.
import { useEffect, useMemo, useState } from "react";
import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import {
  loadDb,
  getAccountsUI,
  getAccountBalancesUI,
  listBalanceReadingsUI,
  type Db,
} from "./lib/db";
import { getIncludePartnerUI } from "./lib/db-setup";
import { netWorthByDay, netWorthCents, pointsInPeriod, type NetWorthMonth } from "../domain/networth";
import { formatShortDate, periodLabel, type Period } from "../domain/period";
import { usePeriod } from "./lib/period-store";
import { formatCents } from "../domain/money";
import ChartBase from "./charts/ChartBase";
import { useStable } from "./charts/useStable";
import type { ChartSeries } from "./charts/types";
import type { Account } from "../domain/types";
import type { AccountBalance, BalanceReading } from "../domain/plan-types";

export interface NetWorthDataLayer {
  loadDb: () => Promise<Db>;
  getAccounts: (db: Db) => Promise<Account[]>;
  getAccountBalances: (db: Db) => Promise<AccountBalance[]>;
  getBalanceReadings: (db: Db) => Promise<BalanceReading[]>;
  getIncludePartner: (db: Db) => Promise<boolean>;
}

const defaultDataLayer: NetWorthDataLayer = {
  loadDb,
  getAccounts: getAccountsUI,
  getAccountBalances: getAccountBalancesUI,
  getBalanceReadings: listBalanceReadingsUI,
  getIncludePartner: () => getIncludePartnerUI(),
};

type Phase = "loading" | "unavailable" | "ready";

interface Loaded {
  accounts: Account[];
  balances: AccountBalance[];
  includePartner: boolean;
  points: NetWorthMonth[];
}

const LEGEND = "Net worth, each day the banks were read";

/** The chart: one point per reading day on a time scale, so a gap between readings shows as a gap. */
function NetWorthChart({ shown }: { shown: NetWorthMonth[] }) {
  const series = useStable<ChartSeries[]>([
    { id: "networth", label: "Net worth", role: "actual", mark: "line", showPoints: true, points: shown.map((p) => ({ x: p.period, cents: p.cents })) },
  ]);
  const summary = chartSummary(shown);
  return (
    <div className="flex flex-col gap-2">
      <span data-testid="networth-chart-summary" className="sr-only" aria-hidden>
        {summary}
      </span>
      <ChartBase title="Net worth over time" description={summary} axis="time" timeScale zoom series={series} formatX={formatShortDate} yFit legend={false} height={288} />
    </div>
  );
}

/** The chart in words, for a screen reader (and the tests). */
function chartSummary(points: NetWorthMonth[]): string {
  return `${LEGEND}: ${points.map((p) => `${formatShortDate(p.period)} ${formatCents(p.cents)}`).join("; ")}.`;
}

export interface NetWorthSectionProps {
  dataLayer?: Partial<NetWorthDataLayer>;
  /** Overrides the shared period. Tests pin it so none depends on today's date. */
  period?: Period;
}

export default function NetWorthSection({ dataLayer, period: pinned }: NetWorthSectionProps) {
  const shared = usePeriod();
  const period = pinned ?? shared;
  const deps = useMemo<NetWorthDataLayer>(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = await deps.loadDb();
        const [accounts, balances, readings, includePartner] = await Promise.all([
          deps.getAccounts(db),
          deps.getAccountBalances(db),
          deps.getBalanceReadings(db),
          deps.getIncludePartner(db),
        ]);
        if (cancelled) return;
        setLoaded({ accounts, balances, includePartner, points: netWorthByDay(accounts, readings, includePartner) });
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deps]);

  if (phase === "loading") return <Skeleton className="h-96 w-full" />;
  if (phase === "unavailable") {
    return (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>The local server is not reachable. Restart the app.</AlertDescription>
      </Alert>
    );
  }
  if (!loaded) return null;

  const headline = netWorthCents(loaded.accounts, loaded.balances, loaded.includePartner);
  const shown = pointsInPeriod(loaded.points, period);
  const first = loaded.points[0];
  const change = shown.length > 1 ? shown[shown.length - 1].cents - shown[0].cents : null;

  return (
    <div className="flex flex-col gap-section">
      <Card foldId="networth-chart">
        <CardHeader>
          <CardDescription>Net worth</CardDescription>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <CardTitle data-testid="networth-headline" className="font-mono text-4xl tabular-nums">
              {formatCents(headline)}
            </CardTitle>
            {change !== null && (
              <span data-testid="networth-change" className="flex items-baseline gap-1.5 text-base">
                <span className={`flex items-center gap-0.5 font-mono tabular-nums ${change < 0 ? "text-destructive" : "text-positive"}`}>
                  {change < 0 ? <ArrowDownRightIcon aria-hidden className="size-4 self-center" /> : <ArrowUpRightIcon aria-hidden className="size-4 self-center" />}
                  {formatCents(Math.abs(change))}
                </span>
                <span className="text-muted-foreground">since {formatShortDate(shown[0].period)}</span>
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loaded.points.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No readings yet. The first is stored at the next bank sync, and the chart starts there.
            </p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No readings inside this period ({periodLabel(period)}). Choose a wider period in the top bar.
            </p>
          ) : (
            <NetWorthChart shown={shown} />
          )}
          {first && (
            <p data-testid="networth-history-note" className="pt-2 text-xs text-muted-foreground">
              A point for each day the banks were read, since {formatShortDate(first.period)}. Earlier days are left
              off, because working them back from transactions was not reliable.
            </p>
          )}
          {shown.length > 0 && (
            <p data-testid="networth-period-note" data-days={shown.length} className="pt-1 text-xs text-muted-foreground">
              {periodLabel(period)}: {shown.length} {shown.length === 1 ? "day" : "days"} drawn. The period only chooses which
              days appear here. The figure above is today&apos;s balance and does not change with it.
            </p>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
