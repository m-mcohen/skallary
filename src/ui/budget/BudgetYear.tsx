// src/ui/budget/BudgetYear.tsx -- the Budget's Year tab.
// A year picker once more than one plan exists. Clicking a finished month, or
// this month, opens the line's panel on that month; a future month opens it on this month
// with Change budget open from that month on.
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { buildMonthView, type MonthRow } from "../../domain/budget-month";
import { buildYearView, type YearRow } from "../../domain/budget-year";
import { localDateIso } from "../../domain/period";
import { defaultBudgetDataLayer, useBudgetData, type BudgetDataLayer } from "./useBudgetData";
import YearTable from "./YearTable";
import LinePanel from "./LinePanel";
import BigMonthDialog, { DeleteBigMonth } from "./BigMonthDialog";
import type { BigMonth } from "../../domain/plan-types";

const linesWord = (n: number) => `${n} ${n === 1 ? "line" : "lines"} with nothing in ${n === 1 ? "it" : "them"}`;

export default function BudgetYear({ planId, onChanged, dataLayer, today: todayProp }: {
  planId: string | null;
  onChanged?: () => void;
  dataLayer?: Partial<BudgetDataLayer>;
  today?: string;
}) {
  const deps = useMemo(() => ({ ...defaultBudgetDataLayer, ...dataLayer }), [dataLayer]);
  const today = todayProp ?? localDateIso();
  const thisMonth = today.slice(0, 7);
  const [picked, setPicked] = useState<string | null>(null);
  const { phase, data, error, reload, db } = useBudgetData(picked ?? planId, deps);
  const [showEmpty, setShowEmpty] = useState(false);
  const [open, setOpen] = useState<{ key: string; month: string; startFrom?: string } | null>(null);
  const [bigLine, setBigLine] = useState<string | null>(null);
  const [bigEdit, setBigEdit] = useState<BigMonth | null>(null);
  const [bigDelete, setBigDelete] = useState<BigMonth | null>(null);
  const isMobile = useIsMobile();
  const view = useMemo(() => (data ? buildYearView({ ...data, today }) : null), [data, today]);
  const changed = () => {
    reload();
    onChanged?.();
  };

  // The panel reads its line from the month it opens on, from the latest data.
  const openRow: MonthRow | null = useMemo(() => {
    if (!open || !data) return null;
    const mv = buildMonthView({ ...data, month: open.month, today, compare: "avg-12", sort: "group" });
    return mv.sections.flatMap((s) => s.rows).find((r) => r.key === open.key) ?? null;
  }, [open, data, today]);

  if (phase === "loading") return <Skeleton className="h-96 w-full rounded-lg" />;
  if (phase === "unavailable" || phase === "error") {
    return (
      <Alert variant={phase === "error" ? "destructive" : "default"}>
        <AlertTitle>{phase === "error" ? "Couldn't load the budget" : "Not connected"}</AlertTitle>
        <AlertDescription>{phase === "error" ? error : "No local database connection. The local server is not reachable. Restart the app."}</AlertDescription>
      </Alert>
    );
  }
  if (!data || !view || !db) {
    return (
      <Alert>
        <AlertTitle>No budget yet</AlertTitle>
        <AlertDescription>There is no budget for this year yet.</AlertDescription>
      </Alert>
    );
  }

  const onCell = (row: YearRow, month: string) => {
    const future = month > thisMonth;
    // Next year's budget (December's Start [year] budget) opens on its own first month, never on
    // this month, which belongs to this year's budget.
    const planStart = data.plan.startDate.slice(0, 7);
    const opensOn = planStart > thisMonth ? planStart : thisMonth;
    setOpen({ key: row.key, month: future ? opensOn : month, startFrom: future ? month : undefined });
  };
  const panel = open && openRow && (
    <LinePanel
      key={`${open.key}|${open.month}|${open.startFrom ?? ""}`}
      row={openRow}
      month={open.month}
      today={today}
      data={data}
      db={db}
      deps={deps}
      startFrom={open.startFrom}
      onChanged={changed}
      onClose={() => setOpen(null)}
      onAddBig={setBigLine}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {data.plans.length > 1 && (
          <Select
            value={data.plan.id}
            onValueChange={(v) => {
              setPicked(v as string);
              setOpen(null);
            }}
            items={data.plans.map((p) => ({ value: p.id, label: p.startDate.slice(0, 4) }))}
          >
            <SelectTrigger aria-label="Year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.plans.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.startDate.slice(0, 4)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-sm text-muted-foreground">
          Finished months show what was spent; shaded months were unusual for that line. Later months show the budget.
        </p>
      </div>
      <YearTable view={view} showEmpty={showEmpty} onCell={onCell} onEditBig={setBigEdit} onDeleteBig={setBigDelete} />
      {view.hiddenCount > 0 && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowEmpty((s) => !s)}>
          {`${showEmpty ? "Hide" : "Show"} ${linesWord(view.hiddenCount)}`}
        </Button>
      )}
      {!isMobile && panel}
      <Sheet
        open={isMobile && !!panel}
        onOpenChange={(o) => {
          if (!o) setOpen(null);
        }}
      >
        <SheetContent side="bottom" showCloseButton={false} className="data-[side=bottom]:h-dvh overflow-y-auto motion-reduce:transition-none">
          <SheetTitle className="sr-only">{openRow?.line ?? "Line"}</SheetTitle>
          {isMobile && panel}
        </SheetContent>
      </Sheet>
      {bigEdit && (
        <BigMonthDialog plan={data.plan} today={today} lines={[bigEdit.planningCategory]} initial={bigEdit} db={db} deps={deps} onClose={() => setBigEdit(null)} onSaved={changed} />
      )}
      {bigDelete && <DeleteBigMonth big={bigDelete} db={db} deps={deps} onClose={() => setBigDelete(null)} onDeleted={changed} />}
      {bigLine && (
        <BigMonthDialog
          plan={data.plan}
          today={today}
          lines={[bigLine]}
          presetLine={bigLine}
          db={db}
          deps={deps}
          onClose={() => setBigLine(null)}
          onSaved={changed}
        />
      )}
    </div>
  );
}
