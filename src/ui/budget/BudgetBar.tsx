// src/ui/budget/BudgetBar.tsx -- the budget bar beside Spent: a solid fill for what was spent and a tick at the budget. Red only when the
// tone says so (over budget by a real amount); otherwise neutral. App-specific: no
// registry item draws a bar with a budget tick.
import { budgetBarGeometry, type Tone } from "../../domain/budget-colors";
import { cn } from "@/lib/utils";

export const toneText: Record<Tone, string> = { red: "text-budget-red", blue: "text-budget-blue", grey: "text-foreground" };

export default function BudgetBar({ spentCents, budgetCents, tone, label }: { spentCents: number; budgetCents: number | null; tone: Tone; label: string }) {
  const g = budgetBarGeometry(spentCents, budgetCents);
  return (
    <div role="img" aria-label={label} className="relative h-2 w-full min-w-16 rounded-full bg-budget-track">
      <div
        data-part="fill"
        className={cn("absolute inset-y-0 left-0 rounded-full", tone === "red" ? "bg-budget-red" : "bg-budget-fill")}
        style={{ width: `${g.fillPct}%` }}
      />
      {g.tickPct !== null && (
        <div data-part="tick" className="absolute -inset-y-1 w-0.5 bg-budget-tick" style={{ left: `calc(${g.tickPct}% - 1px)` }} />
      )}
    </div>
  );
}
