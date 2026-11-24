// src/ui/budget/YearTable.tsx -- the Year tab's grid. Not
// typed into: each cell is a button that opens the line's panel. A vertical line
// separates finished months from this month and later; future months read lighter. On a
// phone the grid scrolls inside its own box with line names frozen.
import { MoreHorizontalIcon, StickyNoteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { BigMonth } from "../../domain/plan-types";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCents, formatWholeDollars } from "../../domain/money";
import { formatMonthShort, formatPeriodLabel } from "../../domain/period";
import { projectedKind } from "./MonthTable";
import type { Shade, YearCell, YearRow, YearTotals, YearView } from "../../domain/budget-year";

const shadeBg: Record<Exclude<Shade, null>, string> = {
  high: "bg-shade-high",
  "high-strong": "bg-shade-high-strong",
  low: "bg-shade-low",
  "low-strong": "bg-shade-low-strong",
};
const shadeWords: Record<Exclude<Shade, null>, string> = {
  high: "higher than usual",
  "high-strong": "much higher than usual",
  low: "lower than usual",
  "low-strong": "much lower than usual",
};
const money = (c: number | null) => (c === null ? "" : formatWholeDollars(c));

/** What a screen reader hears for a cell: the line, the month, the figure and what it is. */
function cellName(row: YearRow, c: YearCell): string {
  const figure = c.cents === null ? "" : `, ${c.state === "future" ? "budget" : "spent"} ${formatCents(c.cents)}`;
  return `${row.line}, ${formatPeriodLabel(c.month)}${figure}${c.shade ? `, ${shadeWords[c.shade]}` : ""}${c.note ? ", has a note" : ""}`;
}
const STICKY = "sticky left-0 z-10 bg-background";

/** Edit and Delete for a big month this month or later; finished ones stay as history. */
export interface BigHandlers { onEditBig?: (b: BigMonth) => void; onDeleteBig?: (b: BigMonth) => void }

export default function YearTable({ view, showEmpty, onCell, onEditBig, onDeleteBig }: { view: YearView; showEmpty: boolean; onCell: (row: YearRow, month: string) => void } & BigHandlers) {
  const split = (m: string) => (m === view.thisMonth ? "border-l-2 border-l-foreground" : "");
  return (
    <div data-testid="year-scroll" className="w-full overflow-x-auto rounded-md border">
      <Table aria-label={`Budget for ${view.year}`}>
        <TableHeader>
          <TableRow>
            <TableHead className={STICKY}>Line</TableHead>
            {view.months.map((m) => (
              <TableHead key={m} className={cn("text-right", split(m))}>
                {formatMonthShort(m).slice(0, 3)}
              </TableHead>
            ))}
            <TableHead className="text-right">Average</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.sections.map((s) => (
            <SectionRows key={s.id} rows={s.rows.filter((r) => showEmpty || !r.hidden)} subtotal={s.subtotal} view={view} split={split} onCell={onCell} onEditBig={onEditBig} onDeleteBig={onDeleteBig} />
          ))}
          <Totals t={view.leftOver} view={view} split={split} strong />
        </TableBody>
      </Table>
    </div>
  );
}

function SectionRows({ rows, subtotal, view, split, onCell, onEditBig, onDeleteBig }: {
  rows: YearRow[];
  subtotal: YearTotals;
  view: YearView;
  split: (m: string) => string;
  onCell: (row: YearRow, month: string) => void;
} & BigHandlers) {
  return (
    <>
      {rows.map((r) => (
        <YearLine key={r.key} row={r} view={view} split={split} onCell={onCell} onEditBig={onEditBig} onDeleteBig={onDeleteBig} />
      ))}
      <Totals t={subtotal} view={view} split={split} />
    </>
  );
}

function YearLine({ row, view, split, onCell, onEditBig, onDeleteBig }: { row: YearRow; view: YearView; split: (m: string) => string; onCell: (row: YearRow, month: string) => void } & BigHandlers) {
  return (
    <>
      <TableRow aria-label={row.line}>
        <TableHead scope="row" role="rowheader" aria-label={`${row.line}${row.setByYou ? ", set by you" : ""}`} className={cn(STICKY, "font-medium text-foreground")}>
          <span className="flex items-center gap-1.5">
            {row.line}
            {row.setByYou && <Badge variant="secondary">Set by you</Badge>}
          </span>
        </TableHead>
        {row.cells.map((c) => (
          <TableCell key={c.month} className={cn("p-0 text-right tabular-nums", split(c.month), c.shade && shadeBg[c.shade])}>
            <button
              type="button"
              aria-label={cellName(row, c)}
              title={c.shade ? shadeWords[c.shade] : undefined}
              onClick={() => onCell(row, c.month)}
              className={cn("flex w-full items-center justify-end gap-1 px-2 py-1.5 hover:underline", c.state === "future" && "text-muted-foreground")}
            >
              {c.note && <StickyNoteIcon className="size-3" aria-hidden="true" />}
              {money(c.cents)}
            </button>
          </TableCell>
        ))}
        <TableCell className="text-right tabular-nums">{money(row.averageCents)}</TableCell>
      </TableRow>
      {row.bigMonths.map((b) => (
        <TableRow key={b.id} aria-label={`${b.label}, ${projectedKind(b)?.toLowerCase() ?? "a big month"}`} className="text-muted-foreground">
          <TableCell className={cn(STICKY, "pl-6")}>
            <span className="flex items-center gap-1">
              {b.label}
              {projectedKind(b) && <Badge variant="outline">{projectedKind(b)}</Badge>}
              {projectedKind(b) && b.obligationYear !== undefined && b.obligationYear < Number(b.month.slice(0, 4)) && (
                <span className="text-xs">carried over from {b.obligationYear}</span>
              )}
              {!b.origin && b.month >= view.thisMonth && onEditBig && onDeleteBig && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Change ${b.label}`} />}>
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => onEditBig(b)}>Edit</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDeleteBig(b)}>Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </span>
          </TableCell>
          {view.months.map((m) => (
            <TableCell key={m} className={cn("text-right tabular-nums", split(m))}>
              {b.month === m ? formatWholeDollars(b.amountCents) : ""}
            </TableCell>
          ))}
          <TableCell />
        </TableRow>
      ))}
    </>
  );
}

function Totals({ t, view, split, strong }: { t: YearTotals; view: YearView; split: (m: string) => string; strong?: boolean }) {
  return (
    <TableRow className={cn("bg-muted/50", strong && "font-semibold")}>
      <TableHead scope="row" role="rowheader" className={cn(STICKY, "bg-muted font-semibold text-foreground")}>
        {t.label}
      </TableHead>
      {t.cells.map((c, i) => (
        <TableCell key={view.months[i]} className={cn("text-right tabular-nums", split(view.months[i]))}>
          {money(c)}
        </TableCell>
      ))}
      <TableCell className="text-right tabular-nums">{money(t.averageCents)}</TableCell>
    </TableRow>
  );
}
