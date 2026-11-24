// src/ui/GoalsSection.tsx
//
// The Goals tab, Monarch-style. A goal is funded by linked accounts
// (an account's entire balance, or a fixed slice) plus an amount saved
// outside them; a planned monthly contribution gives the projected finish
// month and the Ahead / On track / At risk pill. Goals are TRACK-ONLY: they
// never touch buildForecast.
//
// This file only orchestrates: it loads the rows, composes them through the
// pure functions in src/domain/goals.ts (goalFunding, goalThisMonthCents,
// goalStatus, accountFundingSummaries, goalsOverview -- the CLI's `goal list`
// composes the identical way, so the two cannot drift) and hands the results
// to the views in src/ui/goals/. No domain math is reimplemented here.
//
// Registries-first:
//   - `@shadcnblocks/stats-card3` (metric card with a progress bar toward a
//     goal) and `@shadcnblocks/chart-card16` (progress ring toward a goal)
//     are the exact shape and both Pro-gated (401 without an API key), as
//     `stats-card3` already was when this section was first built. Composed
//     @shadcn/card + @shadcn/progress + @shadcn/badge again, matching the
//     established pattern in this repo.
//   - @shadcn/alert-dialog (installed; BudgetGrid.tsx) for the archive and
//     delete confirmations; @shadcn/toggle-group (installed; AccountsSection)
//     for the template and per-account mode pickers, for the jsdom reason
//     AccountsSection.tsx records.
//
// Data layer is injected via the `dataLayer` prop (same shape as the other
// sections) so tests inject stubs and a headless build renders "Not connected".
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";

import {
  loadDb,
  listGoalsUI,
  upsertGoalUI,
  deleteGoalUI,
  listWishlistItemsUI,
  getAccountsUI,
  getAccountBalancesUI,
  getTransactionsUI,
  listGoalAccountLinksUI,
  replaceGoalAccountLinksUI,
  getMortgageRatesUI,
  type MortgageRates,
  setGoalStateUI,
  getBudgetLinesUI,
  type GoalStateChange,
  type Db,
} from "./lib/db";
import type { BudgetLine, Goal, GoalAccountLink, AccountBalance, WishlistItem } from "../domain/plan-types";
import { plannedCategories } from "../domain/budget";
import { canTakeGoalCost } from "../domain/goal-cost";
import type { Account, NormalizedTxn } from "../domain/types";
import { cardDebtCents, goalStatuses, accountFundingSummaries, goalsOverview } from "../domain/goals";
import { wishlistTotal } from "../domain/wishlist";
import { formatWholeDollars } from "../domain/money";

import GoalCard from "./goals/GoalCard";
import GoalDialog from "./goals/GoalDialog";
import GoalAccountsDialog from "./goals/GoalAccountsDialog";
import StartCostDialog from "./goals/StartCostDialog";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { localDateIso } from "../domain/period";

// ---------------------------------------------------------------------------
// Injectable data layer
// ---------------------------------------------------------------------------

export interface GoalsDataLayer {
  loadDb: () => Promise<Db>;
  listGoals: (db: Db) => Promise<Goal[]>;
  upsertGoal: (db: Db, g: Goal) => Promise<void>;
  deleteGoal: (db: Db, id: string) => Promise<void>;
  listWishlistItems: (db: Db) => Promise<WishlistItem[]>;
  getAccounts: (db: Db) => Promise<Account[]>;
  getAccountBalances: (db: Db) => Promise<AccountBalance[]>;
  getTransactions: (db: Db) => Promise<NormalizedTxn[]>;
  listGoalAccountLinks: (db: Db) => Promise<GoalAccountLink[]>;
  replaceGoalAccountLinks: (db: Db, goalId: string, links: GoalAccountLink[]) => Promise<void>;
  /** Today's mortgage rates for the goal dialog's payment helper. */
  getMortgageRates: (db: Db) => Promise<MortgageRates | null>;
  /** Mark complete / unmark, and Start this cost, in one server step. */
  setGoalState: (db: Db, goalId: string, change: GoalStateChange) => Promise<void>;
  /** The plan's budget lines, for "Add to an existing line". */
  getBudgetLines: (db: Db, planId: string) => Promise<BudgetLine[]>;
}

const defaultDataLayer: GoalsDataLayer = {
  loadDb,
  listGoals: listGoalsUI,
  upsertGoal: upsertGoalUI,
  deleteGoal: deleteGoalUI,
  listWishlistItems: listWishlistItemsUI,
  getAccounts: getAccountsUI,
  getAccountBalances: getAccountBalancesUI,
  getTransactions: getTransactionsUI,
  listGoalAccountLinks: listGoalAccountLinksUI,
  replaceGoalAccountLinks: replaceGoalAccountLinksUI,
  getMortgageRates: getMortgageRatesUI,
  setGoalState: setGoalStateUI,
  getBudgetLines: getBudgetLinesUI,
};

export interface GoalsSectionProps {
  /** Override any subset of the data layer (tests inject stubs; App.tsx uses the default). */
  dataLayer?: Partial<GoalsDataLayer>;
  /** Render the add-goal dialog already open -- tests use this to skip driving the trigger button. */
  defaultDialogOpen?: boolean;
  /** The budget plan a started cost is written into; without one, Start this cost is not offered. */
  planId?: string | null;
  /** Told after a cost goes into the budget, so the top bar and Budget read it. */
  onBudgetChanged?: () => void;
  /** Told after every goal change, so the top bar and Forecast re-read goals. */
  onGoalsChanged?: () => void;
}

type Phase = "loading" | "unavailable" | "empty" | "ready" | "error";

/** Accounts, balances, links and transactions: the goal's funding side. */
interface SideData {
  accounts: Account[];
  balances: AccountBalance[];
  links: GoalAccountLink[];
  txns: NormalizedTxn[];
}
const EMPTY_SIDE: SideData = { accounts: [], balances: [], links: [], txns: [] };

type Confirm = { kind: "archive" | "delete" | "unmark"; goal: Goal } | null;
/** The Start this cost confirmation: which goal, and whether Mark complete opened it. */
type CostPrompt = { goal: Goal; markingComplete: boolean } | null;

function todayIso(): string {
  return localDateIso();
}

export default function GoalsSection({ dataLayer, defaultDialogOpen, planId = null, onBudgetChanged, onGoalsChanged }: GoalsSectionProps) {
  const deps = useMemo<GoalsDataLayer>(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);

  const [db, setDb] = useState<Db | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  // null = still loading; "error" = the wish list could not be read (goals still render).
  const [wishItems, setWishItems] = useState<WishlistItem[] | "error" | null>(null);
  // "loading" | "error" | the rows. On error the goals still render (outside
  // amounts only) and account linking is disabled: a replace-all save over
  // unknown links would wipe them.
  const [side, setSide] = useState<SideData | "loading" | "error">("loading");

  const [dialogOpen, setDialogOpen] = useState(!!defaultDialogOpen);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [accountsFor, setAccountsFor] = useState<Goal | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [costPrompt, setCostPrompt] = useState<CostPrompt>(null);
  const [costLines, setCostLines] = useState<string[]>([]);
  const [costBusy, setCostBusy] = useState(false);
  const [costError, setCostError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const refreshGoals = useCallback(
    async (handle: Db) => {
      const rows = await deps.listGoals(handle);
      setGoals(rows);
      return rows;
    },
    [deps]
  );

  const refreshLinks = useCallback(
    async (handle: Db) => {
      const links = await deps.listGoalAccountLinks(handle);
      setSide((s) => (typeof s === "object" ? { ...s, links } : s));
    },
    [deps]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let handle: Db;
      try {
        handle = await deps.loadDb();
      } catch {
        // Expected when the local Node server is unreachable (headless build / preview).
        if (!cancelled) setPhase("unavailable");
        return;
      }
      if (cancelled) return;
      setDb(handle);

      deps.listWishlistItems(handle).then(
        (rows) => { if (!cancelled) setWishItems(rows); },
        () => { if (!cancelled) setWishItems("error"); }
      );

      Promise.all([
        deps.getAccounts(handle),
        deps.getAccountBalances(handle),
        deps.listGoalAccountLinks(handle),
        deps.getTransactions(handle),
      ]).then(
        ([accounts, balances, links, txns]) => { if (!cancelled) setSide({ accounts, balances, links, txns }); },
        () => { if (!cancelled) setSide("error"); }
      );

      try {
        const rows = await refreshGoals(handle);
        if (cancelled) return;
        setPhase(rows.length === 0 ? "empty" : "ready");
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
    // Data layer only meaningfully changes identity across remounts in this app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- composition (all pure; see src/domain/goals.ts) ----------------------

  const sideData = typeof side === "object" ? side : EMPTY_SIDE;
  const asOf = todayIso();

  const computed = useMemo(() => goalStatuses(goals, sideData, asOf), [goals, sideData, asOf]);
  const summaries = useMemo(
    () => accountFundingSummaries(sideData.accounts, sideData.balances, sideData.links),
    [sideData]
  );
  const overview = useMemo(
    () => goalsOverview(computed.map((c) => c.status), summaries, cardDebtCents(sideData.accounts, sideData.balances)),
    [computed, summaries, sideData]
  );
  const active = computed.filter((c) => !c.status.goal.archivedAt);
  const archived = computed.filter((c) => !!c.status.goal.archivedAt);
  const goalNames = useMemo(() => Object.fromEntries(goals.map((g) => [g.id, g.name])), [goals]);

  // --- handlers ----------------------------------------------------------------

  const openAdd = useCallback(() => {
    setEditing(null);
    setDialogOpen(true);
  }, []);
  const openEdit = useCallback((goal: Goal) => {
    setEditing(goal);
    setDialogOpen(true);
  }, []);

  const getRates = useCallback(async () => (db ? deps.getMortgageRates(db) : null), [db, deps]);

  const handleSaveGoal = useCallback(
    async (goal: Goal) => {
      if (!db) throw new Error("Not connected.");
      await deps.upsertGoal(db, goal);
      await refreshGoals(db);
      onGoalsChanged?.();
      setPhase("ready");
    },
    [db, deps, refreshGoals, onGoalsChanged]
  );

  const handleSaveLinks = useCallback(
    async (goalId: string, links: GoalAccountLink[]) => {
      if (!db) throw new Error("Not connected.");
      await deps.replaceGoalAccountLinks(db, goalId, links);
      await refreshLinks(db);
    },
    [db, deps, refreshLinks]
  );

  const setArchived = useCallback(
    async (goal: Goal, archivedAt: string | null) => {
      if (!db) return;
      setBusyId(goal.id);
      try {
        await deps.upsertGoal(db, { ...goal, archivedAt });
        await refreshGoals(db);
        onGoalsChanged?.();
        // Archiving releases the goal's account links on the server.
        await refreshLinks(db);
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
        setPhase("error");
      } finally {
        setBusyId(null);
      }
    },
    [db, deps, refreshGoals, refreshLinks, onGoalsChanged]
  );

  const handleDelete = useCallback(
    async (goal: Goal) => {
      if (!db) return;
      setBusyId(goal.id);
      try {
        await deps.deleteGoal(db, goal.id);
        const rows = await refreshGoals(db);
        onGoalsChanged?.();
        await refreshLinks(db);
        setPhase(rows.length === 0 ? "empty" : "ready");
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
        setPhase("error");
      } finally {
        setBusyId(null);
      }
    },
    [db, deps, refreshGoals, refreshLinks, onGoalsChanged]
  );

  // --- Mark complete / Start this cost -------------

  const applyState = useCallback(
    async (goal: Goal, change: GoalStateChange) => {
      if (!db) throw new Error("Not connected.");
      await deps.setGoalState(db, goal.id, change);
      await refreshGoals(db);
      // A started cost changes the budget too, which re-reads everything;
      // otherwise only the goals changed.
      if (change.startCost) onBudgetChanged?.();
      else onGoalsChanged?.();
    },
    [db, deps, refreshGoals, onBudgetChanged, onGoalsChanged]
  );

  const openCostPrompt = useCallback(
    (goal: Goal, markingComplete: boolean) => {
      setCostError(null);
      setCostPrompt({ goal, markingComplete });
      if (db && planId) {
        void deps
          .getBudgetLines(db, planId)
          // Income and saving lines are never offered: a cost there would count as income, or nowhere.
          .then((lines) => setCostLines(plannedCategories(lines).filter(canTakeGoalCost).sort((a, b) => a.localeCompare(b))))
          .catch(() => setCostLines([]));
      }
    },
    [db, deps, planId]
  );

  const markComplete = useCallback(
    async (goal: Goal) => {
      // A cost still to start is asked about once, in the same step (choice 1A).
      if ((goal.ongoingMonthlyCents ?? 0) > 0 && !goal.ongoingStartedPeriod && planId) return openCostPrompt(goal, true);
      setBusyId(goal.id);
      try {
        await applyState(goal, { completed: true });
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
        setPhase("error");
      } finally {
        setBusyId(null);
      }
    },
    [applyState, openCostPrompt, planId]
  );

  const confirmCost = useCallback(
    async (req: { line: string; mode: "new" | "existing" }) => {
      if (!costPrompt || !planId) return;
      setCostBusy(true);
      setCostError(null);
      try {
        const startCost = { planId, line: req.line, mode: req.mode };
        await applyState(costPrompt.goal, costPrompt.markingComplete ? { completed: true, startCost } : { startCost });
        setCostPrompt(null);
      } catch (e) {
        // The server's own words; the dialog stays open to try another line.
        setCostError(e instanceof Error ? e.message : String(e));
      } finally {
        setCostBusy(false);
      }
    },
    [applyState, costPrompt, planId]
  );

  const costNotNow = useCallback(async () => {
    const prompt = costPrompt;
    setCostPrompt(null);
    // From Mark complete, Not now still marks the goal complete; the cost stays a plan.
    if (prompt?.markingComplete) {
      try {
        await applyState(prompt.goal, { completed: true });
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    }
  }, [applyState, costPrompt]);

  const runConfirm = useCallback(() => {
    if (!confirm) return;
    const { kind, goal } = confirm;
    setConfirm(null);
    if (kind === "archive") void setArchived(goal, new Date().toISOString());
    else if (kind === "unmark") void applyState(goal, { completed: false }).catch((e) => { setErrorMessage(e instanceof Error ? e.message : String(e)); setPhase("error"); });
    else void handleDelete(goal);
  }, [confirm, setArchived, handleDelete, applyState]);

  // --- overview cards -----------------------------------------------------------

  let wishCardBody: React.ReactNode;
  if (wishItems === null) {
    wishCardBody = <Skeleton className="h-8 w-32" />;
  } else if (wishItems === "error") {
    wishCardBody = <p className="text-sm text-destructive">Couldn't load the wish list.</p>;
  } else {
    const t = wishlistTotal(wishItems);
    wishCardBody = (
      <div className="flex flex-col gap-1">
        <span className="font-heading text-2xl font-semibold tabular-nums">{formatWholeDollars(t.totalCents)}</span>
        <span className="text-sm text-muted-foreground">
          {t.count === 0
            ? "Nothing on the list yet. Add items on the Wish List tab."
            : `${t.count} ${t.count === 1 ? "item" : "items"}`}
        </span>
      </div>
    );
  }

  let availableBody: React.ReactNode;
  if (side === "loading") {
    availableBody = <Skeleton className="h-8 w-32" />;
  } else if (side === "error") {
    availableBody = <p className="text-sm text-destructive">Couldn't load accounts, so linked balances are missing.</p>;
  } else {
    availableBody = (
      <div className="flex flex-col gap-1">
        <span className="font-heading text-2xl font-semibold tabular-nums">{formatWholeDollars(overview.availableForGoalsCents)}</span>
        {overview.retirementAvailableCents > 0 && (
          <span data-testid="goals-retirement-available" className="text-sm text-muted-foreground">
            Retirement accounts <span className="font-mono tabular-nums">{formatWholeDollars(overview.retirementAvailableCents)}</span>
          </span>
        )}
        {overview.overAllocatedCount > 0 ? (
          <span className="text-sm text-destructive">
            {overview.overAllocatedCount === 1 ? "1 account is promised more than it holds." : `${overview.overAllocatedCount} accounts are promised more than they hold.`}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Balance no goal has claimed yet</span>
        )}
      </div>
    );
  }

  const overviewRow = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Saved toward goals</CardTitle>
          <CardDescription>Across {overview.activeCount === 1 ? "1 active goal" : `${overview.activeCount} active goals`}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-1">
            <span className="font-heading text-2xl font-semibold tabular-nums">{formatWholeDollars(overview.savedCents)}</span>
            <span className="text-sm text-muted-foreground">of {formatWholeDollars(overview.targetCents)} targeted</span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Available for goals</CardTitle>
          <CardDescription>Cash and brokerage, less card balances and what goals already claim</CardDescription>
        </CardHeader>
        <CardContent>{availableBody}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Personal Wish List</CardTitle>
          <CardDescription>Running total of everything on the Wish List tab</CardDescription>
        </CardHeader>
        <CardContent>{wishCardBody}</CardContent>
      </Card>
    </div>
  );

  // --- body ----------------------------------------------------------------------

  const renderCards = (items: typeof computed) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(({ funding, status }) => (
        <GoalCard
          key={status.goal.id}
          status={status}
          funding={funding}
          accountsAvailable={typeof side === "object"}
          busy={busyId === status.goal.id}
          onEdit={() => openEdit(status.goal)}
          onAccounts={() => setAccountsFor(status.goal)}
          onArchive={() => setConfirm({ kind: "archive", goal: status.goal })}
          onUnarchive={() => void setArchived(status.goal, null)}
          onDelete={() => setConfirm({ kind: "delete", goal: status.goal })}
          onStartCost={planId ? () => openCostPrompt(status.goal, false) : undefined}
          onMarkComplete={() => void markComplete(status.goal)}
          onUnmarkComplete={() => setConfirm({ kind: "unmark", goal: status.goal })}
        />
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (phase === "loading") {
    body = (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  } else if (phase === "unavailable") {
    body = (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>
          No local database connection. The local server is not reachable. Restart the app.
        </AlertDescription>
      </Alert>
    );
  } else if (phase === "error") {
    body = (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load goals</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
    );
  } else if (phase === "empty") {
    body = (
      <Alert>
        <AlertTitle>No goals yet</AlertTitle>
        <AlertDescription>Add a goal, then link the accounts that fund it.</AlertDescription>
      </Alert>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {active.length === 0 ? (
          <Alert>
            <AlertTitle>No active goals</AlertTitle>
            <AlertDescription>Every goal is archived. Unarchive one below, or add a new goal.</AlertDescription>
          </Alert>
        ) : (
          renderCards(active)
        )}
        {archived.length > 0 && (
          <div className="flex flex-col gap-3">
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide archived goals" : `Show archived goals (${archived.length})`}
            </Button>
            {showArchived && renderCards(archived)}
          </div>
        )}
      </div>
    );
  }

  const editingRow = editing ? computed.find((c) => c.status.goal.id === editing.id) : undefined;
  const editingFunding = editingRow?.funding;
  const linkedCents = editingFunding ? editingFunding.savedCents - editingFunding.outsideCents : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-base font-semibold">Goals</h2>
          <p className="text-sm text-muted-foreground">
            Save-up goals funded by your accounts. Savings are tracked here. An ongoing cost goes into your budget when you start it.
          </p>
        </div>
        {phase !== "loading" && phase !== "unavailable" && (
          <Button onClick={openAdd}>
            <PlusIcon />
            Add goal
          </Button>
        )}
      </div>
      {phase !== "loading" && phase !== "unavailable" && overviewRow}
      {body}

      {phase !== "loading" && phase !== "unavailable" && (
        <GoalDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} linkedCents={linkedCents} thisMonthCents={editingRow?.status.thisMonthCents ?? null} onSave={handleSaveGoal} getRates={getRates} />
      )}
      <GoalAccountsDialog
        open={accountsFor !== null}
        onOpenChange={(open) => { if (!open) setAccountsFor(null); }}
        goal={accountsFor}
        summaries={summaries}
        links={sideData.links}
        goalNames={goalNames}
        onSave={handleSaveLinks}
      />
      <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "delete"
                ? `Delete ${confirm.goal.name}?`
                : confirm?.kind === "unmark"
                  ? `Unmark ${confirm.goal.name} complete?`
                  : `Archive ${confirm?.goal.name ?? ""}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "unmark"
                ? confirm.goal.ongoingBudgetLine
                  ? `Its budget line, ${confirm.goal.ongoingBudgetLine}, stays. Remove it on the Budget screen if you no longer have this cost.`
                  : "It goes back to being a goal in progress."
                : confirm?.kind === "delete"
                ? "This removes the goal and its account links. This cannot be undone."
                : "It leaves the active list, its numbers stop counting toward the totals, and its account links are released so other goals can use those balances. You can unarchive it later, then link accounts again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirm}>
              {confirm?.kind === "delete" ? "Delete goal" : confirm?.kind === "unmark" ? "Unmark complete" : "Archive goal"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <StartCostDialog
        open={costPrompt !== null}
        goal={costPrompt?.goal ?? null}
        existingLines={costLines}
        markingComplete={costPrompt?.markingComplete ?? false}
        busy={costBusy}
        error={costError}
        onConfirm={(req) => void confirmCost(req)}
        onNotNow={() => void costNotNow()}
        onOpenChange={(open) => { if (!open) setCostPrompt(null); }}
      />
    </div>
  );
}
