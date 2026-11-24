// src/ui/budget/MonthTable.tsx -- the month screen's table:
// Line, Budget, Spent with the budget bar, Left, the comparison figure, Change with the
// change bar. Fixed costs, Variable costs and Income each end in a subtotal; Left over
// closes the table. A big month is an indented row under its line. On a phone (under md)
// Budget, Left and the comparison move under the line's name in small text.
import { useEffect, useRef, type ReactNode } from "react";
import { MoreHorizontalIcon, StickyNoteIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCents } from "../../domain/money";
import { formatPeriodLabel } from "../../domain/period";
import { PAYCHECKS_LINE } from "../../domain/budget-income";
import type { MonthRow, MonthSection, MonthTotals, MonthView } from "../../domain/budget-month";
import type { BigMonth } from "../../domain/plan-types";
import BudgetBar, { toneText } from "./BudgetBar";
import { potName } from "../../help/household-words";
import ChangeBar from "./ChangeBar";

const money = (c: number | null) => (c === null ? "" : formatCents(c));
const signed = (c: number | null) => (c === null ? "" : c > 0 ? `+${formatCents(c)}` : formatCents(c));
const WIDE = "hidden md:table-cell";

/** A row made from a yearly bill or a raise is projected, never stored: it is named and cannot be edited or deleted here. */
export const projectedKind = (b: BigMonth): "Yearly bill" | "Raise" | null => (b.origin === "yearly-bill" ? "Yearly bill" : b.origin === "raise" ? "Raise" : null);

function RowExtras({ row, view }: { row: MonthRow; view: MonthView }) {
  return (
    <>
      {row.setByYou && <Badge variant="secondary">Set by you</Badge>}
      {row.headingOver && <Badge variant="outline" className="text-budget-red">Heading over</Badge>}
      {row.note && (
        <Popover>
          <PopoverTrigger
            render={<button type="button" aria-label={`Note for ${row.line}`} className="text-muted-foreground hover:text-foreground" />}
            onClick={(e) => e.stopPropagation()}
          >
            <StickyNoteIcon className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent className="w-64 text-sm">{row.note}</PopoverContent>
        </Popover>
      )}
      {row.budgetFrom === "settings" && <span className="text-xs text-muted-foreground">from Settings</span>}
      {row.budgetFrom === "maaser" && <span className="text-xs text-muted-foreground">{potName()} from Settings</span>}
      {row.side === "income" && row.line === PAYCHECKS_LINE && row.budgetCents === null && view.noSalaryNote && (
        <span className="block w-full text-xs text-muted-foreground">{view.noSalaryNote}</span>
      )}
    </>
  );
}

function LineRow({ row, view, open, onOpen }: { row: MonthRow; view: MonthView; open: boolean; onOpen: () => void }) {
  const phone = [
    row.budgetCents !== null ? `Budget ${money(row.budgetCents)}` : null,
    row.leftCents !== null ? `Left ${money(row.leftCents)}` : null,
    row.comparisonCents !== null ? `${view.comparisonLabel} ${money(row.comparisonCents)}` : null,
  ].filter(Boolean);
  return (
    <TableRow aria-label={row.line} data-state={open ? "selected" : undefined} className="cursor-pointer" onClick={onOpen}>
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="text-left font-medium hover:underline"
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            {row.line}
          </button>
          <RowExtras row={row} view={view} />
        </div>
        {phone.length > 0 && <div className="text-xs text-muted-foreground md:hidden">{phone.join(" · ")}</div>}
      </TableCell>
      <TableCell className={cn(WIDE, "text-right tabular-nums")}>{money(row.budgetCents)}</TableCell>
      <TableCell className="min-w-28">
        <div className="text-right tabular-nums">{formatCents(row.spentCents)}</div>
        <BudgetBar
          spentCents={row.spentCents}
          budgetCents={row.budgetCents}
          tone={row.barTone}
          label={`${row.line}: ${row.side === "income" ? "received" : "spent"} ${formatCents(row.spentCents)}${row.budgetCents === null ? "" : ` of ${formatCents(row.budgetCents)}`}`}
        />
      </TableCell>
      <TableCell className={cn(WIDE, "text-right tabular-nums")}>
        <span className={toneText[row.leftTone]}>{money(row.leftCents)}</span>
      </TableCell>
      <TableCell className={cn(WIDE, "text-right tabular-nums")}>{money(row.comparisonCents)}</TableCell>
      <TableCell className="min-w-28">
        <div className={cn("text-right tabular-nums", toneText[row.changeTone])}>{signed(row.changeCents)}</div>
        <ChangeBar
          changeCents={row.changeCents}
          scaleCents={view.changeScale[row.side]}
          tone={row.changeTone}
          label={row.changeCents === null ? `${row.line}: no comparison` : `${row.line}: ${signed(row.changeCents)} against ${view.comparisonLabel}`}
        />
      </TableCell>
    </TableRow>
  );
}

function BigRow({ big, locked, onEdit, onDelete }: { big: BigMonth; locked: boolean; onEdit: () => void; onDelete: () => void }) {
  const kind = projectedKind(big);
  return (
    <TableRow aria-label={`${big.label}, ${kind ? kind.toLowerCase() : "a big month"}`} className="text-muted-foreground">
      <TableCell className="pl-8">
        <div className="flex flex-wrap items-center gap-1">
          <span>{big.label}</span>
          {kind && <Badge variant="outline">{kind}</Badge>}
          {kind && big.obligationYear !== undefined && big.obligationYear < Number(big.month.slice(0, 4)) && (
            <span className="text-xs">carried over from {big.obligationYear}</span>
          )}
          {!locked && !big.origin && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Change ${big.label}`} />}>
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="text-xs md:hidden">{kind ?? "Big month"} {formatCents(big.amountCents)}</div>
      </TableCell>
      <TableCell className={cn(WIDE, "text-right tabular-nums")}>{formatCents(big.amountCents)}</TableCell>
      <TableCell colSpan={4} />
    </TableRow>
  );
}

function TotalRow({ t, view, strong }: { t: MonthTotals; view: MonthView; strong?: boolean }) {
  return (
    <TableRow className={cn("bg-muted/50", strong && "font-semibold")}>
      <TableHead scope="row" role="rowheader" className="font-semibold text-foreground">{t.label}</TableHead>
      <TableCell className={cn(WIDE, "text-right tabular-nums")}>{money(t.budgetCents)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCents(t.spentCents)}</TableCell>
      <TableCell className={cn(WIDE, "text-right tabular-nums")}>
        <span className={toneText[t.leftTone]}>{money(t.leftCents)}</span>
      </TableCell>
      <TableCell className={cn(WIDE, "text-right tabular-nums")}>{money(t.comparisonCents)}</TableCell>
      <TableCell>
        <div className={cn("text-right tabular-nums", toneText[t.changeTone])}>{signed(t.changeCents)}</div>
        <span className="sr-only">against {view.comparisonLabel}</span>
      </TableCell>
    </TableRow>
  );
}

interface Handlers {
  showEmpty: boolean;
  openKey: string | null;
  /**
   * The open line's panel, shown in a row right under that line. Null on a phone, where it
   * opens in a sheet instead.
   */
  openPanel?: ReactNode;
  onOpen: (row: MonthRow) => void;
  onEditBig: (b: BigMonth) => void;
  onDeleteBig: (b: BigMonth) => void;
  locked: boolean;
}

function SectionRows({ section, view, h }: { section: MonthSection; view: MonthView; h: Handlers }) {
  const rows = section.rows.filter((r) => h.showEmpty || !r.hidden);
  return (
    <>
      {section.id === "spending" && (
        <TableRow>
          <TableHead scope="row" role="rowheader" colSpan={6} className="text-foreground">{section.title}</TableHead>
        </TableRow>
      )}
      {rows.map((r) => (
        <RowWithBigs key={r.key} row={r} view={view} h={h} />
      ))}
      <TotalRow t={section.subtotal} view={view} />
    </>
  );
}

/** The panel's row: the full width of the table, under its line. On opening it scrolls just enough to be seen. */
function PanelRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    // Instant, not smooth: no motion to reduce (reduced-motion safe).
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  return (
    <TableRow ref={ref} data-testid="line-panel-row" className="hover:bg-transparent">
      <TableCell colSpan={6} className="whitespace-normal p-2">
        {children}
      </TableCell>
    </TableRow>
  );
}

function RowWithBigs({ row, view, h }: { row: MonthRow; view: MonthView; h: Handlers }) {
  const open = h.openKey === row.key;
  return (
    <>
      <LineRow row={row} view={view} open={open} onOpen={() => h.onOpen(row)} />
      {open && h.openPanel && <PanelRow>{h.openPanel}</PanelRow>}
      {row.bigMonths.map((b) => (
        <BigRow key={b.id} big={b} locked={h.locked} onEdit={() => h.onEditBig(b)} onDelete={() => h.onDeleteBig(b)} />
      ))}
    </>
  );
}

export default function MonthTable({ view, ...h }: { view: MonthView } & Handlers) {
  return (
    <Table aria-label={`Budget for ${formatPeriodLabel(view.month)}`}>
      <TableHeader>
        <TableRow>
          <TableHead>Line</TableHead>
          <TableHead className={cn(WIDE, "text-right")}>Budget</TableHead>
          <TableHead className="text-right">{view.inProgress ? "Spent so far" : "Spent"}</TableHead>
          <TableHead className={cn(WIDE, "text-right")}>Left</TableHead>
          <TableHead className={cn(WIDE, "text-right")}>{view.comparisonLabel}</TableHead>
          <TableHead className="text-right">Change</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {view.sections.map((s) => (
          <SectionRows key={s.id} section={s} view={view} h={h} />
        ))}
        <TotalRow t={view.leftOver} view={view} strong />
      </TableBody>
    </Table>
  );
}
