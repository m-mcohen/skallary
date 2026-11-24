// src/ui/dashboard/GoalsCard.tsx -- the Dashboard's Goals card: how close am I to my goals? One row per active goal: its progress
// and what it needs a month to finish by its date. Computed by goalStatuses, the
// same function the Goals screen uses, so the two can never disagree. Read-only;
// editing stays on the Goals screen.
//
// Built from the app's own Card and Progress.
import { useEffect, useMemo, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

import {
  loadDb,
  getAccountBalancesUI,
  getAccountsUI,
  getTransactionsUI,
  listGoalAccountLinksUI,
  listGoalsUI,
  type Db,
} from "../lib/db";
import { formatProgressPct, goalStatuses, goalTargetText } from "../../domain/goals";
import { localDateIso } from "../../domain/period";
import { formatWholeDollars } from "../../domain/money";
import type { Goal, GoalAccountLink, AccountBalance, GoalStatus } from "../../domain/plan-types";
import type { Account, NormalizedTxn } from "../../domain/types";

export interface GoalsCardDataLayer {
  loadDb: () => Promise<Db>;
  listGoals: (db: Db) => Promise<Goal[]>;
  getAccounts: (db: Db) => Promise<Account[]>;
  getAccountBalances: (db: Db) => Promise<AccountBalance[]>;
  listGoalAccountLinks: (db: Db) => Promise<GoalAccountLink[]>;
  getTransactions: (db: Db) => Promise<NormalizedTxn[]>;
}

const defaultDataLayer: GoalsCardDataLayer = {
  loadDb,
  listGoals: listGoalsUI,
  getAccounts: getAccountsUI,
  getAccountBalances: getAccountBalancesUI,
  listGoalAccountLinks: listGoalAccountLinksUI,
  getTransactions: getTransactionsUI,
};

type Loaded = {
  goals: Goal[];
  side: { accounts: Account[]; balances: AccountBalance[]; links: GoalAccountLink[]; txns: NormalizedTxn[] };
};

/** What a goal needs a month, in words when there is no figure. */
function needText(status: GoalStatus): string {
  if (status.status === "completed") return "Completed";
  if (status.status === "fully_saved") return "Fully saved";
  if (status.recommendedMonthlyCents === null) return "Needs a target date";
  return `About ${formatWholeDollars(status.recommendedMonthlyCents)} a month`;
}

export default function GoalsCard({
  dataLayer,
  asOf,
  asOfToday = false,
}: {
  dataLayer?: Partial<GoalsCardDataLayer>;
  asOf?: string;
  /** The Dashboard shows a past month: goals stay today's, and the card says so. */
  asOfToday?: boolean;
}) {
  const deps = useMemo<GoalsCardDataLayer>(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const today = asOf ?? localDateIso();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = await deps.loadDb();
        const [goals, accounts, balances, links, txns] = await Promise.all([
          deps.listGoals(db),
          deps.getAccounts(db),
          deps.getAccountBalances(db),
          deps.listGoalAccountLinks(db),
          deps.getTransactions(db),
        ]);
        if (!cancelled) setLoaded({ goals, side: { accounts, balances, links, txns } });
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deps]);

  const active = useMemo(
    () => (loaded ? goalStatuses(loaded.goals, loaded.side, today).filter((r) => !r.status.goal.archivedAt) : []),
    [loaded, today]
  );

  let body;
  if (unavailable) {
    body = <p className="text-sm text-muted-foreground">Goals could not be loaded. The local server is not reachable.</p>;
  } else if (!loaded) {
    body = <Skeleton className="h-24 w-full" />;
  } else if (active.length === 0) {
    body = <p className="text-sm text-muted-foreground">No active goals yet.</p>;
  } else {
    body = (
      <ul className="flex flex-col gap-3">
        {active.map(({ status }) => (
          <li key={status.goal.id} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{status.goal.name}</span>
                {/* The savings target leads. */}
                <span data-testid={`goal-target-${status.goal.id}`} className="truncate text-xs text-muted-foreground tabular-nums">
                  {goalTargetText(status.goal)}
                </span>
              </span>
              <span data-testid={`goal-need-${status.goal.id}`} className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {needText(status)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Progress value={status.progressPct * 100} aria-label={`${status.goal.name} progress`} className="flex-1" />
              <span data-testid={`goal-progress-${status.goal.id}`} className="w-12 text-right font-mono text-xs tabular-nums">
                {formatProgressPct(status.progressPct)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card aria-label="Goals" foldId="dash-goals">
      <CardHeader>
        <CardTitle className="text-base">Goals</CardTitle>
        <CardDescription>
          {asOfToday ? "As of today: how close each goal is, and what it needs a month to finish on time." : "How close each goal is, and what it needs a month to finish on time."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {body}
        <a href="#/goals/goals" className="self-start text-xs text-primary hover:underline">
          Open Goals
        </a>
      </CardContent>
    </Card>
  );
}
