// src/ui/what-if/WhatIfSection.tsx
//
// The What if screen. One place to answer "what salary
// do I need for the costs and goals I switch on, and does mine cover them?":
// pick or start a what-if, give it an income, and keep one list, in the user's order,
// of its changes, each goal's saving and each goal's ongoing cost, every row
// switched on or off. A verdict sits at the top when a salary applies; the
// ladder beside the list explains it.
//
// Two rules shape this file:
// - Editing never switches the app. The screen keeps its own selection and
//   takes no way to turn a what-if on; only the top-bar menu does that.
// - Every finished edit saves the whole what-if at once (one PUT), and then
//   tells the app, so a what-if that is on updates every screen. There is no
//   unsaved state to lose by clicking away.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getLifestyleGroupsUI } from "../lib/db-setup";
import type { LifestyleGroup } from "../../domain/lifestyle-groups";

import {
  createWhatIfUI,
  deleteScenarioUI,
  getAccountBalancesUI,
  getAccountsUI,
  getBudgetLinesUI,
  getSalarySettingsUI,
  getTransactionsUI,
  listGoalAccountLinksUI,
  listGoalsUI,
  listScenariosUI,
  listWhatIfsUI,
  loadDb,
  saveWhatIfUI,
  upsertScenarioUI,
  type Db,
} from "../lib/db";
import { useConfirm } from "../ConfirmDialog";
import ChangeForm, { type FormKind } from "./ChangeForm";
import ListRowItem from "./ChangeRow";
import IncomeCard from "./IncomeCard";
import VerdictBlock from "./VerdictBlock";
import LoanDialog, { type LoanKind } from "./LoanDialog";
import LadderPanel from "./LadderPanel";
import CheckSalaryBox from "./CheckSalaryBox";
import { SetUpCard } from "../setup/SetUpCard";
import { taxSetUpNeeded } from "../../domain/tax";
import { resolveMonthlyPlan, usualMonthLines } from "../../domain/budget";
import { isIncomeCategory } from "../../domain/dedup";
import { formatCents } from "../../domain/money";
import { formatMonthShort, localDateIso } from "../../domain/period";
import { addMonths, type Scenario } from "../../domain/scenario";
import { DEFAULT_SALARY_ASSUMPTIONS, type SalaryAssumptions } from "../../domain/salary";
import {
  ladderGoalsFrom,
  normalMonthCents,
  rowsOf,
  salaryVerdict,
  verdictText,
  whatIfLadder,
  whatIfList,
  type LadderGoal,
  type ListRow,
  type WhatIf,
  type WhatIfChange,
} from "../../domain/what-if";
import { computeRunway, drawableLiquidCents } from "../../domain/runway";
import { cashForecast } from "../../domain/cash-forecast";
import { RUNWAY_HORIZON_MONTHS } from "../../domain/runway-projection";
import type { Account, NormalizedTxn } from "../../domain/types";
import type { AccountBalance, BudgetLine, Goal, GoalAccountLink } from "../../domain/plan-types";

export interface WhatIfDataLayer {
  loadDb: () => Promise<Db>;
  listScenarios: (db: Db, planId: string) => Promise<Scenario[]>;
  listWhatIfs: (db: Db, planId: string) => Promise<WhatIf[]>;
  saveWhatIf: (db: Db, w: WhatIf) => Promise<void>;
  /** New: the scenario row and its empty what-if, in one request. */
  createWhatIf: (db: Db, planId: string, id: string, name: string) => Promise<WhatIf>;
  upsertScenario: (db: Db, s: Scenario) => Promise<void>;
  deleteScenario: (db: Db, id: string) => Promise<void>;
  getBudgetLines: (db: Db, planId: string) => Promise<BudgetLine[]>;
  getSalarySettings: (db: Db) => Promise<SalaryAssumptions>;
  listGoals: (db: Db) => Promise<Goal[]>;
  getAccounts: (db: Db) => Promise<Account[]>;
  getAccountBalances: (db: Db) => Promise<AccountBalance[]>;
  listGoalAccountLinks: (db: Db) => Promise<GoalAccountLink[]>;
  getTransactions: (db: Db) => Promise<NormalizedTxn[]>;
  /** The saved lifestyle groups, or null for the starter groups. */
  getLifestyleGroups: () => Promise<LifestyleGroup[] | null>;
}

const defaultDataLayer: WhatIfDataLayer = {
  loadDb,
  listScenarios: listScenariosUI,
  listWhatIfs: listWhatIfsUI,
  saveWhatIf: saveWhatIfUI,
  createWhatIf: createWhatIfUI,
  upsertScenario: upsertScenarioUI,
  deleteScenario: deleteScenarioUI,
  getBudgetLines: getBudgetLinesUI,
  getSalarySettings: getSalarySettingsUI,
  listGoals: listGoalsUI,
  getAccounts: getAccountsUI,
  getAccountBalances: getAccountBalancesUI,
  listGoalAccountLinks: listGoalAccountLinksUI,
  getTransactions: getTransactionsUI,
  getLifestyleGroups: getLifestyleGroupsUI,
};

export interface WhatIfSectionProps {
  planId: string | null;
  /** After naming, creating or deleting a what-if (the scenarios row itself changes): the app re-reads fully. */
  onChanged?: () => void;
  /**
   * After an edit to a what-if's income, changes or goal picks: a lighter refresh, since only the what_if_* tables moved.
   * Falls back to `onChanged` when not given, so a caller that only wires one
   * callback still gets correct behavior.
   */
  onWhatIfSaved?: () => void;
  dataLayer?: Partial<WhatIfDataLayer>;
  /** The local server cannot be reached: the shell's Not connected banner explains, so no loading blocks or advice here. */
  unavailable?: boolean;
}

type Loaded = {
  db: Db;
  rows: Scenario[];
  whatIfs: WhatIf[];
  lines: BudgetLine[];
  assumptions: SalaryAssumptions;
  lifestyleGroups?: LifestyleGroup[];
  /** Every active goal whose cost has not started, with its saving a month as set up on Goals. */
  goals: LadderGoal[];
  /** The goals as stored, for the planned costs the what-if carries. */
  rawGoals: Goal[];
  /** Goals whose ongoing cost has started: in the budget already (choice 4). */
  startedGoals: { id: string; name: string }[];
  drawableCents: number;
};

/** A read the ladder or the runway line can do without: a failure leaves it empty, not the screen. */
const orEmpty = <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);

function newId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
}

export default function WhatIfSection({ planId, onChanged, onWhatIfSaved, dataLayer, unavailable = false }: WhatIfSectionProps) {
  const deps = useMemo(() => ({ ...defaultDataLayer, ...dataLayer }), [dataLayer]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm();

  // Naming dialog: a new what-if, or a rename of the selected one.
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
  const [nameText, setNameText] = useState("");
  const [nameProblem, setNameProblem] = useState<string | null>(null);

  // The change dialog.
  const [form, setForm] = useState<{ kind: FormKind | LoanKind; editing: WhatIfChange | null } | null>(null);
  // A fresh dialog starts without the last refusal.
  const openForm = (f: { kind: FormKind | LoanKind; editing: WhatIfChange | null }) => {
    setSaveError(null);
    setForm(f);
  };


  const today = localDateIso();
  const nextMonth = addMonths(today.slice(0, 7), 1);

  const reload = useCallback(
    async (select?: string | null) => {
      if (!planId) return;
      try {
        const db = await deps.loadDb();
        const [rows, whatIfs, lines, assumptions, goals, accounts, balances, links, txns, savedGroups] = await Promise.all([
          deps.listScenarios(db, planId),
          deps.listWhatIfs(db, planId),
          deps.getBudgetLines(db, planId),
          deps.getSalarySettings(db).catch(() => DEFAULT_SALARY_ASSUMPTIONS),
          orEmpty(deps.listGoals(db)),
          orEmpty(deps.getAccounts(db)),
          orEmpty(deps.getAccountBalances(db)),
          orEmpty(deps.listGoalAccountLinks(db)),
          orEmpty(deps.getTransactions(db)),
          deps.getLifestyleGroups().catch(() => null),
        ]);
        // Each goal's saving a month as set up on the Goals screen.
        const active = goals.filter((g) => !g.archivedAt);
        // A goal whose cost has started is already in the budget: never on the list (choice 4).
        const startedGoals = active.filter((g) => g.ongoingStartedPeriod).map((g) => ({ id: g.id, name: g.name }));
        const ladderGoals = ladderGoalsFrom(goals, { accounts, balances, links, txns }, localDateIso());
        setLoaded({ db, rows, whatIfs, lines, assumptions, lifestyleGroups: savedGroups ?? undefined, goals: ladderGoals, rawGoals: goals, startedGoals, drawableCents: drawableLiquidCents(accounts, balances) });
        setFailed(false);
        if (select !== undefined) setSelectedId(select);
      } catch {
        setFailed(true);
      }
    },
    [deps, planId]
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // Only rows that carry a what-if are offered; older scenarios stay out.
  const options = useMemo(() => {
    if (!loaded) return [];
    const ids = new Set(loaded.whatIfs.map((w) => w.scenarioId));
    return loaded.rows.filter((r) => ids.has(r.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [loaded]);

  // Open on the first what-if; fall back to it when the selected one is gone.
  useEffect(() => {
    if (!loaded) return;
    if (selectedId === null || !options.some((o) => o.id === selectedId)) setSelectedId(options[0]?.id ?? null);
  }, [loaded, options, selectedId]);

  const selected = options.find((o) => o.id === selectedId) ?? null;
  const whatIf = (selected && loaded?.whatIfs.find((w) => w.scenarioId === selected.id)) ?? null;
  // The one list, in the user's order.
  const list = useMemo(() => (whatIf && loaded ? whatIfList(whatIf, loaded.goals) : []), [whatIf, loaded]);
  const [showStarted, setShowStarted] = useState(false);


  const expenseLines = useMemo(
    () =>
      [...new Set((loaded?.lines ?? []).filter((l) => l.period === null || l.period === "").map((l) => l.planningCategory))]
        .filter((c) => !isIncomeCategory(c))
        .sort((a, b) => a.localeCompare(b)),
    [loaded]
  );
  // A line's every-month amount: the ladder measures a Change or Cut from it.
  const lineTodayCents = useCallback((line: string) => resolveMonthlyPlan(usualMonthLines(loaded?.lines ?? [], nextMonth), line, nextMonth), [loaded, nextMonth]);
  const budgetBeforeCents = useMemo(() => normalMonthCents(loaded?.lines ?? [], nextMonth), [loaded, nextMonth]);

  const ladder = useMemo(
    () => (whatIf && loaded ? whatIfLadder(whatIf, loaded.lines, loaded.goals, nextMonth, loaded.assumptions, loaded.lifestyleGroups) : null),
    [whatIf, loaded, nextMonth]
  );

  // The verdict: the what-if's own salary, else the current
  // yearly salary it keeps. None when neither is a yearly salary.
  const verdict = useMemo(() => {
    if (!whatIf || !loaded || !ladder) return null;
    const current = loaded.assumptions.currentSalary;
    const gross = whatIf.salaryGrossAnnualCents ?? (current?.kind === "gross" ? current.grossAnnualCents : null);
    if (gross === null || gross <= 0) return null;
    // With no salary of its own the what-if keeps the user's current salary, so the user's firm tax
    // figures from Settings apply; a what-if's own salary is estimated.
    const v = salaryVerdict(ladder, gross, loaded.assumptions, { whatIf, baseLines: loaded.lines, currentSalary: whatIf.salaryGrossAnnualCents === null });
    return { text: verdictText(v, whatIf.salaryGrossAnnualCents === null ? "current" : "own"), short: !v.covered };
  }, [whatIf, loaded, ladder]);

  // The runway line: the Forecast screen's own figure, under this what-if.
  const runway = useMemo(() => {
    if (!whatIf || !selected || !loaded) return null;
    // The Forecast screen's own projection, real income against this
    // what-if's salary, additional salary and switched-on costs (src/domain/cash-forecast.ts).
    return computeRunway(loaded.drawableCents, cashForecast({ budgetLines: loaded.lines, asOfDate: today, assumptions: loaded.assumptions, whatIf, goals: loaded.rawGoals }));
  }, [whatIf, selected, loaded, today]);

  /** Save the whole what-if; the screen shows it only once the server has it. */
  const persist = async (next: WhatIf): Promise<boolean> => {
    if (!loaded) return false;
    setBusy(true);
    setSaveError(null);
    try {
      // Changes are numbered in the list's order, so their stored order agrees with it.
      const order = new Map(next.rows.filter((r) => r.kind === "change").map((r, i) => [r.refId, i]));
      const sorted = [...next.changes].sort((x, y) => (order.get(x.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(y.id) ?? Number.MAX_SAFE_INTEGER));
      const renumbered = { ...next, changes: sorted.map((c, i) => ({ ...c, position: i + 1 })) };
      await deps.saveWhatIf(loaded.db, renumbered);
      setLoaded((l) => (l ? { ...l, whatIfs: l.whatIfs.map((w) => (w.scenarioId === renumbered.scenarioId ? renumbered : w)) } : l));
      // An edit here only ever touches the what_if_*
      // tables, never the scenarios row, so the app needs only the lighter
      // refresh -- not the full one naming, creating or deleting a what-if uses.
      (onWhatIfSaved ?? onChanged)?.();
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // --- naming -----------------------------------------------------------------

  const openNaming = (mode: "new" | "rename") => {
    setNaming(mode);
    setNameText(mode === "rename" ? selected?.name ?? "" : "");
    setNameProblem(null);
  };

  const submitName = async () => {
    const name = nameText.trim();
    if (!name) return setNameProblem("Give the what-if a name.");
    if (!loaded || !planId) return;
    setBusy(true);
    try {
      if (naming === "new") {
        const id = newId("whatif");
        // One step: a failure here can never leave an
        // empty scenarios row behind, because there is only one request.
        await deps.createWhatIf(loaded.db, planId, id, name);
        await reload(id);
      } else if (selected) {
        await deps.upsertScenario(loaded.db, { ...selected, name });
        await reload(selected.id);
      }
      setNaming(null);
      onChanged?.();
    } catch (e) {
      setNameProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const askDelete = () => {
    if (!selected || !loaded) return;
    ask({
      title: `Delete ${selected.name}? This cannot be undone.`,
      description: "Its income, its changes and its list go with it. Your budget, your goals and your other what-ifs stay as they are.",
      confirmLabel: "Delete what-if",
      onConfirm: () => {
        void (async () => {
          setBusy(true);
          try {
            await deps.deleteScenario(loaded.db, selected.id);
            await reload(null);
            onChanged?.();
          } catch (e) {
            setSaveError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        })();
      },
    });
  };

  // --- the list -------------------------------------------------------------------

  /** Save the list as it now stands, every row stored with its place and switch. */
  const saveList = (next: Pick<ListRow, "kind" | "refId" | "on">[], changes: WhatIfChange[] = whatIf?.changes ?? []) => {
    if (!whatIf) return Promise.resolve(false);
    return persist({ ...whatIf, changes, rows: rowsOf(next) });
  };

  const move = (index: number, direction: -1 | 1) => {
    const next = [...list];
    const [r] = next.splice(index, 1);
    next.splice(index + direction, 0, r);
    void saveList(next);
  };

  const toggle = (index: number, on: boolean) => {
    void saveList(list.map((r, i) => (i === index ? { ...r, on } : r)));
  };

  const saveChange = async (draft: Omit<WhatIfChange, "id" | "position">) => {
    if (!whatIf || !form) return;
    if (form.editing) {
      const changes = whatIf.changes.map((c) => (c.id === form.editing!.id ? { ...c, ...draft } : c));
      if (await saveList(list, changes)) setForm(null);
      return;
    }
    // A new change joins the bottom of the list, switched on.
    const added = { ...draft, id: newId("change"), position: whatIf.changes.length + 1 };
    if (await saveList([...list, { kind: "change", refId: added.id, on: true }], [...whatIf.changes, added])) setForm(null);
  };

  const askRemove = (c: WhatIfChange) => {
    if (!whatIf) return;
    ask({
      title: `Remove ${c.label} from this what-if?`,
      description: "The rest of the what-if stays as it is.",
      confirmLabel: "Remove change",
      onConfirm: () =>
        void saveList(
          list.filter((r) => !(r.kind === "change" && r.refId === c.id)),
          whatIf.changes.filter((x) => x.id !== c.id)
        ),
    });
  };

  // --- render -------------------------------------------------------------------

  if (unavailable) return null;
  if (!planId) return <p className="text-sm text-muted-foreground">Pick a budget first.</p>;
  if (failed) return <p className="text-sm text-muted-foreground">The what-ifs could not be read. Restart the app and try again.</p>;
  if (!loaded) return <Skeleton data-testid="whatif-loading" className="h-72 w-full" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {options.length > 0 && (
          <>
            <Label htmlFor="wi-pick" className="text-sm">
              What-if
            </Label>
            <select
              id="wi-pick"
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </>
        )}
        <Button size="sm" onClick={() => openNaming("new")} disabled={busy}>
          New what-if
        </Button>
        {selected && (
          <>
            <Button size="sm" variant="outline" onClick={() => openNaming("rename")} disabled={busy}>
              Rename
            </Button>
            <Button size="sm" variant="outline" onClick={askDelete} disabled={busy}>
              Delete
            </Button>
          </>
        )}
      </div>

      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          Not saved: {saveError}
        </p>
      )}

      {!selected || !whatIf ? (
        <p className="text-sm text-muted-foreground">No what-ifs yet. Start one.</p>
      ) : (
        <>
          {/* The answer first; the ladder below explains it. */}
          {/* Every figure below estimates federal tax: until the tax step is set up, the card stands in. */}
          {taxSetUpNeeded(loaded.assumptions) ? (
            <SetUpCard step="tax" what="The verdict, the salary ladder and Check a salary estimate federal tax, which needs your filing status and children." />
          ) : (
            verdict && <VerdictBlock text={verdict.text} short={verdict.short} />
          )}

          {/* Remounted whenever the saved income changes, so it always starts from what is saved. */}
          <IncomeCard
            key={`${whatIf.scenarioId}|${whatIf.salaryGrossAnnualCents}|${whatIf.salaryFromPeriod}|${JSON.stringify(whatIf.additionalSalary ?? null)}`}
            whatIf={whatIf}
            busy={busy}
            currentSalary={loaded.assumptions.currentSalary ?? null}
            onSave={(cents, from, additional) => persist({ ...whatIf, salaryGrossAnnualCents: cents, salaryFromPeriod: from, additionalSalary: additional })}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Reading order: the ladder on the left, the list on the right; first on a phone. */}
            <Card data-testid="ladder-panel">
              <CardHeader>
                <CardTitle>Salary ladder</CardTitle>
                <CardDescription>Base salary only. Your salary as an income statement, then the salary you would need. Uses Settings, Salary for tax, benefits and charity. State and local taxes are not estimated; type them from a pay stub.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {ladder && taxSetUpNeeded(loaded.assumptions) && <SetUpCard step="tax" what="Salary needed estimates federal tax, which needs your filing status and children." />}
                {ladder && !taxSetUpNeeded(loaded.assumptions) && (
                  <>
                    <LadderPanel ladder={ladder} />
                    <div className="border-t pt-3">
                      <p className="mb-2 font-medium">Check a salary</p>
                      <CheckSalaryBox
                        ladder={ladder}
                        assumptions={loaded.assumptions}
                        initialSalaryCents={whatIf.salaryGrossAnnualCents ?? (loaded.assumptions.currentSalary?.kind === "gross" ? loaded.assumptions.currentSalary.grossAnnualCents : null)}
                        currentSalaryCents={whatIf.salaryGrossAnnualCents === null && loaded.assumptions.currentSalary?.kind === "gross" ? loaded.assumptions.currentSalary.grossAnnualCents : null}
                        context={{ whatIf, baseLines: loaded.lines }}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>What this what-if includes</CardTitle>
                <CardDescription>
                  Budget before these changes <span className="font-mono">{formatCents(budgetBeforeCents)}</span>. Switch a row off to leave it out everywhere while this what-if is on. The ladder and Check a salary take the rows in this order.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {list.length === 0 ? (
                  <p className="text-muted-foreground">Nothing yet. Add a change below, or add a goal on the Goals screen.</p>
                ) : (
                  <ol className="flex flex-col">
                    {list.map((r, i) => (
                      <ListRowItem
                        key={`${r.kind}:${r.refId}`}
                        row={r}
                        first={i === 0}
                        last={i === list.length - 1}
                        busy={busy}
                        onToggle={(on) => toggle(i, on)}
                        onMove={(d) => move(i, d)}
                        onEdit={
                          r.kind === "change" && r.change
                            ? () => openForm({ kind: r.change!.kind === "car" || r.change!.kind === "mortgage" ? (r.change!.loan ? r.change!.kind : "add") : r.change!.kind, editing: r.change! })
                            : undefined
                        }
                        onRemove={r.kind === "change" && r.change ? () => askRemove(r.change!) : undefined}
                      />
                    ))}
                  </ol>
                )}
                <p className="text-xs text-muted-foreground">A goal's saving a month is set up on the Goals screen. New goals arrive switched off.</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openForm({ kind: "add", editing: null })} disabled={busy}>
                    Add a cost
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openForm({ kind: "change", editing: null })} disabled={busy}>
                    Change a cost
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openForm({ kind: "cut", editing: null })} disabled={busy}>
                    Cut a cost
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openForm({ kind: "car", editing: null })} disabled={busy}>
                    Car
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openForm({ kind: "mortgage", editing: null })} disabled={busy}>
                    Mortgage
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openForm({ kind: "one-time", editing: null })} disabled={busy}>
                    One-time cost
                  </Button>
                </div>
                {/* Goals whose cost is already in the budget: off the
                    list so nothing counts twice, collapsed, with the reason in view. */}
                {loaded.startedGoals.length > 0 && (
                  <div className="flex flex-col">
                    <Button variant="ghost" size="sm" className="self-start px-0" aria-expanded={showStarted} onClick={() => setShowStarted((v) => !v)}>
                      {showStarted ? <ChevronDownIcon /> : <ChevronRightIcon />}
                      Completed goals ({loaded.startedGoals.length})
                    </Button>
                    <span className="text-xs text-muted-foreground">Already in your budget</span>
                    {showStarted && (
                      <ul className="flex flex-col pt-1">
                        {loaded.startedGoals.map((g) => (
                          <li key={g.id} data-testid={`goal-started-${g.id}`} className="py-1 text-muted-foreground">
                            {g.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {runway && (
                  <p data-testid="whatif-runway" className="text-muted-foreground">
                    Runway with this what-if:{" "}
                    {runway.crossZeroPeriod === null || runway.runwayMonths === null
                      ? `lasts past ${RUNWAY_HORIZON_MONTHS} months.`
                      : `${runway.runwayMonths} month${runway.runwayMonths === 1 ? "" : "s"}, until ${formatMonthShort(runway.crossZeroPeriod)}.`}
                  </p>
                )}
              </CardContent>
            </Card>

          </div>
        </>
      )}

      <Dialog open={naming !== null} onOpenChange={(open) => !open && setNaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{naming === "rename" ? "Rename this what-if" : "New what-if"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor="wi-name">Name</Label>
            <Input id="wi-name" value={nameText} onChange={(e) => setNameText(e.target.value)} placeholder="Acme $150k" />
            {nameProblem && (
              <p role="alert" className="text-sm text-destructive">
                {nameProblem}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNaming(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitName()} disabled={busy}>
              {naming === "rename" ? "Save name" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {form && (form.kind === "car" || form.kind === "mortgage") && (
        <LoanDialog
          open
          onOpenChange={(open) => !open && setForm(null)}
          kind={form.kind}
          editing={form.editing}
          defaultFrom={nextMonth}
          onSave={(c) => void saveChange(c)}
          busy={busy}
          saveError={saveError}
        />
      )}

      {form && form.kind !== "car" && form.kind !== "mortgage" && (
        <ChangeForm
          open
          onOpenChange={(open) => !open && setForm(null)}
          kind={form.kind}
          editing={form.editing}
          lines={expenseLines}
          lineTodayCents={lineTodayCents}
          defaultFrom={nextMonth}
          onSave={(c) => void saveChange(c)}
          busy={busy}
          saveError={saveError}
        />
      )}

      {confirmDialog}
    </div>
  );
}
