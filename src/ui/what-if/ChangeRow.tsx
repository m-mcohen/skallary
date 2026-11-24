// src/ui/what-if/ChangeRow.tsx
//
// One row of a what-if's one list: a change, a goal's
// saving, or a goal's ongoing cost. Each has a switch (on counts, off counts
// nowhere while this what-if is on), the arrows to move it anywhere in the list,
// and, for a change, edit and remove. Presentational; no motion.
//
// Registry search (`npx shadcn@latest search @shadcn @shadcn-studio
// @shadcnblocks`, "switch", "sortable list", "item"): the installed @shadcn/switch
// is the switch; the sortable lists found (shadcnblocks list-panel-list-drag-*,
// shadcn-studio sortable-01) are drag-to-reorder through dnd-kit, a new dependency,
// where arrows are wanted; @shadcn/item is a generic row layout the app's
// own list pattern already covers.
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatCents } from "../../domain/money";
import { formatMonthShort } from "../../domain/period";
import { changeAmountCents, type ListRow, type WhatIfChange } from "../../domain/what-if";

/** "Add $700.00 a month to Car payment", "Cut Groceries entirely", "Change Rent to $2,800.00 a month". */
export function describeChange(c: WhatIfChange): string {
  // Paid once, in its month: "$15,000.00 once, in Mar 2027".
  if (c.kind === "one-time") return `${formatCents(c.amountCents)} once, in ${formatMonthShort(c.fromPeriod)}`;
  // Its own start month: before a mortgage's payoff, so this always reads
  // the full payment (principal, interest, tax and insurance) it opened with.
  const amount = `${formatCents(changeAmountCents(c, c.fromPeriod))} a month`;
  switch (c.kind) {
    case "change":
      return `Change ${c.planningCategory} to ${amount}`;
    case "cut":
      return c.amountCents === 0 ? `Cut ${c.planningCategory} entirely` : `Cut ${c.planningCategory} to ${amount}`;
    case "car":
      return `Car payment of ${amount}, on ${c.planningCategory}`;
    case "mortgage":
      return `Mortgage payment of ${amount}, on ${c.planningCategory}`;
    default:
      return `Add ${amount} to ${c.planningCategory}`;
  }
}

/** What a row does, in plain words, under its name. */
export function describeRow(r: ListRow): string {
  if (r.kind === "change" && r.change) {
    const down = r.change.loan && r.change.loan.downPaymentCents > 0 ? `, plus ${formatCents(r.change.loan.downPaymentCents)} down, paid once` : "";
    return `${describeChange(r.change)}${down}`;
  }
  const g = r.goal;
  if (r.kind === "goal-cost") return `${formatCents(r.monthlyCents ?? 0)} a month once you have it`;
  if (!g) return "";
  if (g.complete) return "Fully saved, nothing more needed";
  if (g.recommendedMonthlyCents === null) return "No target date or planned amount yet. Set one on Goals.";
  const amount = `Saves ${formatCents(g.recommendedMonthlyCents)} a month`;
  if (g.savingSource === "planned") return `${amount}, your planned amount${g.finishPeriod ? `, fully saved by ${formatMonthShort(g.finishPeriod)}` : ""}`;
  if (g.savingSource === "target-date") return `${amount}, worked out from the target date${g.finishPeriod ? ` (${formatMonthShort(g.finishPeriod)})` : ""}`;
  return amount;
}

export interface ListRowItemProps {
  row: ListRow;
  first: boolean;
  last: boolean;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  /** A change only: goal rows are set up on the Goals screen. */
  onEdit?: () => void;
  onRemove?: () => void;
}

export default function ListRowItem({ row, first, last, busy, onToggle, onMove, onEdit, onRemove }: ListRowItemProps) {
  return (
    <li
      data-testid="list-row"
      data-row-kind={row.kind}
      data-ref-id={row.refId}
      data-on={row.on ? "true" : "false"}
      className="flex items-start gap-2 border-b py-2 last:border-b-0"
    >
      {/* A 24 px target around the switch. */}
      <span className="inline-flex min-h-6 min-w-6 items-center justify-center pt-0.5">
        <Switch checked={row.on} disabled={busy} onCheckedChange={(on: boolean) => onToggle(on)} aria-label={`Include ${row.label}`} />
      </span>
      <div className={`flex min-w-0 flex-1 flex-col ${row.on ? "" : "text-muted-foreground"}`}>
        <span className="font-medium">{row.label}</span>
        <span className="text-muted-foreground">{describeRow(row)}</span>
      </div>
      <div className="flex shrink-0 items-center">
        <Button variant="ghost" size="icon-sm" aria-label={`Move ${row.label} up`} disabled={first || busy} onClick={() => onMove(-1)}>
          <ArrowUpIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Move ${row.label} down`} disabled={last || busy} onClick={() => onMove(1)}>
          <ArrowDownIcon />
        </Button>
        {onEdit && (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${row.label}`} disabled={busy} onClick={onEdit}>
            <PencilIcon />
          </Button>
        )}
        {onRemove && (
          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${row.label}`} disabled={busy} onClick={onRemove}>
            <XIcon />
          </Button>
        )}
      </div>
    </li>
  );
}
