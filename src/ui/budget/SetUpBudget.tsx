// src/ui/budget/SetUpBudget.tsx -- Set up budget. Per line: a tick box, the basis, now, suggested, change. Every change
// starts ticked and small ones carry "small"; lines set by the user start unticked with what a
// tick would clear listed under them. Below, before and after as boxes change: Monthly
// budget, Left over a month, Salary needed (gross). In next-year mode the same screen
// starts next year's budget; unticked lines carry December's amount, and nothing is
// created until its button is pressed.
//
// Typed amounts: every line's amount is a box. It starts at the suggestion;
// typing over it ticks the line and uses the typed amount. The standard categories are listed
// (with no history, at 0), so a first budget can be typed here line by line.
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCents, formatWholeDollars, parseDollarsToCents } from "../../domain/money";
import { formatPeriodLabel } from "../../domain/period";
import { addMonths } from "../../domain/scenario";
import { applyTicked, basisLabel, setupLines, setupTotals, withTypedAmount, type SetupLine } from "../../domain/setup";
import { resolveMonthlyPlan } from "../../domain/budget";
import { expandChanges } from "../../domain/budget-changes";
import { sideOf } from "../../domain/budget-income";
import type { BudgetLine } from "../../domain/plan-types";
import type { LineSuggestion } from "../../domain/suggest";
import { summariseForMasthead } from "../lib/instrument";
import { taxSetUpNeeded } from "../../domain/tax";
import { SetUpCard } from "../setup/SetUpCard";
import type { Db } from "../lib/db";
import type { BudgetData, BudgetDataLayer } from "./useBudgetData";

const signed = (c: number) => (c > 0 ? `+${formatCents(c)}` : formatCents(c));
const boxText = (c: number) => formatCents(c).replace("$", "");

/** The typed text as cents, or null when it is blank or not an amount (the suggestion then stands). */
function typedCents(text: string | undefined): number | null {
  if (text === undefined || text.trim() === "") return null;
  try {
    return parseDollarsToCents(text);
  } catch {
    return null;
  }
}

export default function SetUpBudget({ mode, data, db, deps, today, onDone, onCancel }: {
  mode: "review" | "next-year";
  data: BudgetData;
  db: Db;
  deps: BudgetDataLayer;
  today: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const year = String(Number(data.plan.startDate.slice(0, 4)) + (mode === "next-year" ? 1 : 0));
  const month = mode === "next-year" ? data.plan.endDate.slice(0, 7) : today.slice(0, 7);
  const through = addMonths(data.plan.endDate.slice(0, 7), 36);
  const [suggestions, setSuggestions] = useState<LineSuggestion[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    deps
      .getSetup(db, data.plan.id)
      .then((r) => {
        if (!cancelled) setSuggestions(r.suggestions);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [deps, db, data.plan.id]);

  const baseRows = useMemo(() => (suggestions ? setupLines({ ...data, suggestions, month }) : []), [suggestions, data, month]);
  useEffect(() => {
    setTicked(new Set(baseRows.filter((r) => r.startsTicked).map((r) => r.line)));
    setTyped(new Map());
  }, [baseRows]);
  const rows = useMemo(
    () =>
      baseRows.map((r) => {
        const cents = typedCents(typed.get(r.line));
        return cents === null ? r : withTypedAmount(r, cents);
      }),
    [baseRows, typed],
  );

  const picks = useMemo(() => rows.filter((r) => ticked.has(r.line)).map((r) => ({ line: r.line, amountCents: r.applyCents })), [rows, ticked]);
  // Next year's lines, built once and used for both the preview and the save: a ticked line at its suggestion, an unticked one at its December amount; goals do
  // not carry. Set up budget lists spending lines only, so every income budget the user set, by
  // every-month amount or "from a month on", rides along at its December amount.
  const nextYearLines = useMemo(() => {
    const out: { line: string; amountCents: number; source: "you" | "suggested" }[] = rows.map((r) =>
      ticked.has(r.line)
        ? { line: r.line, amountCents: r.suggestion.amountCents, source: "suggested" as const }
        : { line: r.line, amountCents: r.nowCents, source: r.setByYou ? ("you" as const) : ("suggested" as const) },
    );
    const listed = new Set(out.map((l) => l.line));
    const incomeNames = new Set([...data.lines.map((l) => l.planningCategory), ...data.changes.map((c) => c.planningCategory)]);
    for (const name of incomeNames) {
      if (listed.has(name) || sideOf(name) !== "income") continue;
      const base = data.lines.filter((l) => l.origin !== "change" && l.planningCategory === name);
      const mine = data.changes.filter((c) => c.planningCategory === name && c.reason === "changed");
      if (base.length === 0 && mine.length === 0) continue;
      const amountCents = resolveMonthlyPlan(expandChanges(base, mine, month), name, month);
      const setByYou = mine.length > 0 || base.some((l) => l.source === "you");
      out.push({ line: name, amountCents, source: setByYou ? "you" : "suggested" });
    }
    return out;
  }, [rows, ticked, data.lines, data.changes, month]);

  const totals = useMemo(() => {
    if (!suggestions) return null;
    const need = (lines: BudgetLine[]) =>
      summariseForMasthead({
        accounts: [], balances: [], budgetLines: lines, categorySettings: data.settings, uncategorizedCount: 0, ruleCount: 0,
        lastSyncedAt: null, asOfDate: today, salaryAssumptions: data.salary,
      }).salary?.grossAnnualCents ?? null;
    const after =
      mode === "next-year"
        ? { lines: nextYearLines.map((l) => ({ planId: data.plan.id, planningCategory: l.line, period: null, amountCents: l.amountCents, source: l.source })), changes: [] }
        : applyTicked(data.lines, data.changes, picks, through);
    return { before: setupTotals(data, month, today, need), after: setupTotals({ ...data, ...after, bigMonths: [] }, month, today, need) };
  }, [suggestions, data, picks, through, month, today, mode, nextYearLines]);

  const toggle = (line: string, on: boolean) =>
    setTicked((t) => {
      const n = new Set(t);
      if (on) n.add(line);
      else n.delete(line);
      return n;
    });
  // Split by the suggestions, not the typed amounts, so a line never moves while it is typed in.
  const changedNames = new Set(baseRows.filter((r) => r.changeCents !== 0).map((r) => r.line));
  const changedRows = rows.filter((r) => changedNames.has(r.line));
  const unchanged = rows.filter((r) => !changedNames.has(r.line));
  const type = (line: string, text: string) => {
    setTyped((t) => new Map(t).set(line, text));
    if (typedCents(text) !== null) toggle(line, true);
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "review") {
        await deps.applySetup(db, data.plan.id, picks);
      } else {
        await deps.startNextYear(db, data.plan.id, nextYearLines);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const table = (list: SetupLine[]) => (
    <div className="w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <span className="sr-only">Apply</span>
            </TableHead>
            <TableHead>Line</TableHead>
            <TableHead className="hidden md:table-cell">Basis</TableHead>
            <TableHead className="text-right">Now</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((r) => (
            <TableRow key={r.line} aria-label={r.line}>
              <TableCell>
                <Checkbox aria-label={r.line} checked={ticked.has(r.line)} onCheckedChange={(c: boolean) => toggle(r.line, c)} />
              </TableCell>
              <TableCell className="whitespace-normal">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{r.line}</span>
                  {r.setByYou && <Badge variant="secondary">Set by you</Badge>}
                  {r.small && <Badge variant="outline">small</Badge>}
                </div>
                <div className="text-xs text-muted-foreground md:hidden">{basisLabel(r.suggestion, r.fixed)}</div>
                {r.setByYou && r.clears.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    This clears: {r.clears.map((c) => `${formatCents(c.amountCents)} from ${formatPeriodLabel(c.fromMonth)}`).join(", ")}
                  </div>
                )}
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{basisLabel(r.suggestion, r.fixed)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCents(r.nowCents)}</TableCell>
              <TableCell className="text-right">
                <Input
                  aria-label={`${r.line} amount`}
                  inputMode="decimal"
                  className="ml-auto w-28 text-right tabular-nums"
                  value={typed.get(r.line) ?? boxText(r.suggestion.amountCents)}
                  onChange={(e) => type(r.line, e.target.value)}
                />
              </TableCell>
              <TableCell className="text-right tabular-nums">{signed(r.changeCents)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  const title = mode === "next-year" ? `Start ${year} budget` : "Set up budget";
  const figure = (label: string, id: string, b: number | null | undefined, a: number | null | undefined, whole = false) => {
    const fmt = (c: number | null | undefined) => (c == null ? "" : whole ? formatWholeDollars(c) : formatCents(c));
    return (
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span data-testid={id} className="tabular-nums">
          {fmt(b)} to {fmt(a)}
        </span>
      </div>
    );
  };

  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">
          {mode === "next-year"
            ? `Now is each line's amount in ${formatPeriodLabel(month)}. Unticked lines carry that amount into ${year}.`
            : "Suggested amounts come from each line's bill, or its 12-month average with empty months counted. Type over any amount to use your own. Nothing changes until you apply."}
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!suggestions ? (
        <p className="text-sm text-muted-foreground">Working out the suggestions.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setTicked(new Set(changedRows.map((r) => r.line)))}>
              Tick every change
            </Button>
            <Button size="sm" variant="outline" onClick={() => setTicked(new Set())}>
              Untick all
            </Button>
          </div>
          {changedRows.length > 0 && table(changedRows)}
          {unchanged.length > 0 && (
            // A first budget has no changes, so its lines open at once.
            <Collapsible defaultOpen={changedRows.length === 0}>
              <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="self-start" />}>
                {unchanged.length} {unchanged.length === 1 ? "line" : "lines"} unchanged
              </CollapsibleTrigger>
              <CollapsibleContent>{table(unchanged)}</CollapsibleContent>
            </Collapsible>
          )}
          <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
            {figure("Monthly budget", "setup-monthly", totals?.before.monthlyCents, totals?.after.monthlyCents)}
            {figure("Left over a month", "setup-leftover", totals?.before.leftOverCents, totals?.after.leftOverCents)}
            {/* Salary needed estimates federal tax: until the tax step is set up, the card says so instead. */}
            {taxSetUpNeeded(data.salary) ? (
              <SetUpCard step="tax" what="Salary needed estimates federal tax, which needs your filing status and children." />
            ) : (
              figure("Salary needed (gross)", "setup-salary", totals?.before.salaryNeededCents, totals?.after.salaryNeededCents, true)
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={apply} disabled={busy}>
              {mode === "next-year" ? `Start ${year} budget` : picks.length === 0 ? "Keep as is" : `Apply ${picks.length} ${picks.length === 1 ? "change" : "changes"}`}
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
