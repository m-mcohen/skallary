// src/ui/budget/GoBackDialog.tsx -- "Go back to suggested": lists every change it clears and the amount the line returns to, then clears
// them on confirm. Goal changes stay ("Kept"). On an income line it reads "Clear budget":
// income is never suggested, so the line goes back to no budget.
import { useEffect, useState } from "react";
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
import { formatCents } from "../../domain/money";
import { formatPeriodLabel } from "../../domain/period";
import { lineChangesIn } from "../../domain/budget-changes";
import type { MonthRow } from "../../domain/budget-month";
import type { LineSuggestion } from "../../domain/suggest";
import type { Db } from "../lib/db";
import type { BudgetData, BudgetDataLayer } from "./useBudgetData";

export function basisWords(s: LineSuggestion): string {
  if (s.basis.kind === "bill") return "from the bill";
  if (s.basis.months === 0) return "with no spending history";
  return s.basis.months >= 12 ? "from your 12-month average" : `from your ${s.basis.months}-month average`;
}

export default function GoBackDialog({ row, data, db, deps, onClose, onDone }: {
  row: MonthRow;
  data: BudgetData;
  db: Db;
  deps: BudgetDataLayer;
  onClose: () => void;
  onDone: () => void;
}) {
  const { changed, goals } = lineChangesIn(data.changes, row.line);
  const everyMonth = data.lines.find((l) => l.planningCategory === row.line && l.period === null && l.origin !== "change");
  const income = row.side === "income";
  const [suggestion, setSuggestion] = useState<LineSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (income) return;
    let cancelled = false;
    deps
      .getLineSuggestion(db, data.plan.id, row.line)
      .then((s) => {
        if (!cancelled) setSuggestion(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [deps, db, data.plan.id, row.line, income]);

  const clears = [
    ...(everyMonth?.source === "you" ? [`${formatCents(everyMonth.amountCents)} every month`] : []),
    ...changed.map((c) => `${formatCents(c.amountCents)} from ${formatPeriodLabel(c.fromMonth)}`),
  ];
  const goalName = (id: string | null) => data.goals.find((g) => g.id === id)?.name ?? "a goal";

  return (
    <AlertDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{income ? `Clear the budget for ${row.line}?` : `Go back to suggested for ${row.line}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {clears.length > 0 && <span className="block">This clears: {clears.join(", ")}.</span>}
            {income && <span className="block">The line goes back to no budget.</span>}
            {!income && suggestion && (
              <span className="block">
                Back to {formatCents(suggestion.amountCents)} a month, {basisWords(suggestion)}.
              </span>
            )}
            {goals.length > 0 && (
              <span className="block">
                Kept: {goals.map((g) => `${formatCents(g.amountCents)} from ${formatPeriodLabel(g.fromMonth)} for goal ${goalName(g.goalId)}`).join(", ")}.
              </span>
            )}
            {error && <span className="block text-destructive">{error}</span>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!income && suggestion === null}
            onClick={async () => {
              try {
                await deps.resetBudgetLine(db, data.plan.id, row.line);
                onDone();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            {income ? "Clear budget" : "Go back"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
