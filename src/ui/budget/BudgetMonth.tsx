// src/ui/budget/BudgetMonth.tsx -- the Budget screen's Month tab. Opens on this month against the 12-month average; the comparison choice is
// remembered in this browser; "By group" or "Biggest change first". Clicking a line opens
// its panel under the table (a full-height sheet on a phone). Replaces the AG Grid Table.
import { useCallback, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";
import MonthBar from "../dashboard/MonthBar";
import { monthNav } from "../../domain/dashboard-month";
import { nextYearOf } from "../../domain/plan-choice";
import { buildMonthView, COMPARE_CHOICES, type CompareChoice, type MonthRow } from "../../domain/budget-month";
import { formatDateRange, formatPeriodLabel, localDateIso, monthBounds } from "../../domain/period";
import { addMonths } from "../../domain/scenario";
import type { BigMonth } from "../../domain/plan-types";
import { defaultBudgetDataLayer, useBudgetData, type BudgetDataLayer } from "./useBudgetData";
import MonthTable from "./MonthTable";
import LinePanel from "./LinePanel";
import BigMonthDialog, { DeleteBigMonth } from "./BigMonthDialog";
import SetUpBudget from "./SetUpBudget";

const COMPARE_KEY = "budget.compare";

function readCompare(): CompareChoice {
  try {
    const raw = window.localStorage.getItem(COMPARE_KEY);
    if (raw && (/^(avg-12|avg-3|last-month|last-year)$/.test(raw) || /^month:\d{4}-\d{2}$/.test(raw))) return raw as CompareChoice;
  } catch {
    // Private window or blocked storage: open on the default.
  }
  return "avg-12";
}

function saveCompare(c: CompareChoice) {
  try {
    window.localStorage.setItem(COMPARE_KEY, c);
  } catch {
    // Not remembered; harmless.
  }
}

const linesWord = (n: number) => `${n} ${n === 1 ? "line" : "lines"} with nothing in ${n === 1 ? "it" : "them"}`;

export interface BudgetMonthProps {
  planId: string | null;
  onChanged?: () => void;
  dataLayer?: Partial<BudgetDataLayer>;
  today?: string;
  /** Open Set up budget straight away (the Dashboard's Review your budget link, #/budget/month?setup=1). */
  startSetup?: boolean;
}

export default function BudgetMonth({ planId, onChanged, dataLayer, today: todayProp, startSetup }: BudgetMonthProps) {
  const deps = useMemo(() => ({ ...defaultBudgetDataLayer, ...dataLayer }), [dataLayer]);
  const today = todayProp ?? localDateIso();
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  // The month picks its own year's budget once more than one exists.
  const { phase, data, error, reload, db } = useBudgetData(planId, deps, month);
  const [compare, setCompareRaw] = useState<CompareChoice>(readCompare);
  const [sort, setSort] = useState<"group" | "change">("group");
  const [showEmpty, setShowEmpty] = useState(false);
  const [openRow, setOpenRow] = useState<MonthRow | null>(null);
  const [bigEdit, setBigEdit] = useState<{ initial?: BigMonth; line?: string } | null>(null);
  const [bigDelete, setBigDelete] = useState<BigMonth | null>(null);
  const [setup, setSetup] = useState<"review" | "next-year" | null>(startSetup ? "review" : null);
  const isMobile = useIsMobile();
  // Closing Set up budget clears the Dashboard link's ?setup=1,
  // so a reload does not reopen it.
  const closeSetup = useCallback(() => {
    setSetup(null);
    try {
      const h = window.location.hash;
      if (/[?&]setup=1/.test(h)) window.history.replaceState(window.history.state, "", h.replace(/[?&]setup=1/, "").replace(/^([^?]*)&/, "$1?"));
    } catch {
      // No history to tidy (an old browser or a test without one).
    }
  }, []);

  const setCompare = useCallback((c: CompareChoice) => {
    setCompareRaw(c);
    saveCompare(c);
  }, []);
  const changed = useCallback(() => {
    reload();
    onChanged?.();
  }, [reload, onChanged]);

  const firstMonth = useMemo(() => (data ? data.plans.map((p) => p.startDate.slice(0, 7)).sort()[0] ?? null : null), [data]);
  const view = useMemo(() => (data ? buildMonthView({ ...data, month, today, compare, sort }) : null), [data, month, today, compare, sort]);
  // A row from the latest view, so the open panel follows a save.
  const liveRow = openRow && view ? view.sections.flatMap((s) => s.rows).find((r) => r.key === openRow.key) ?? openRow : openRow;
  const pastMonths = useMemo(() => {
    const out: string[] = [];
    const stop = firstMonth ? addMonths(firstMonth, -24) : addMonths(month, -36);
    for (let m = addMonths(month, -1); m >= stop; m = addMonths(m, -1)) out.push(m);
    return out;
  }, [firstMonth, month]);

  if (phase === "loading") return <Skeleton className="h-96 w-full rounded-lg" />;
  if (phase === "unavailable") {
    return (
      <Alert>
        <AlertTitle>Not connected</AlertTitle>
        <AlertDescription>No local database connection. The local server is not reachable. Restart the app.</AlertDescription>
      </Alert>
    );
  }
  if (phase === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load the budget</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (phase === "no-plan" || !data || !view || !db) {
    return (
      <Alert>
        <AlertTitle>No budget yet</AlertTitle>
        <AlertDescription>There is no budget for this year yet.</AlertDescription>
      </Alert>
    );
  }

  // Set up budget opens in place of the table; Cancel returns to it.
  if (setup === "next-year" || (setup === "review" && data.plan.endDate.slice(0, 7) >= thisMonth)) {
    return (
      <SetUpBudget
        mode={setup}
        data={data}
        db={db}
        deps={deps}
        today={today}
        onDone={() => {
          closeSetup();
          changed();
        }}
        onCancel={closeSetup}
      />
    );
  }

  const nextYear = nextYearOf(data.plans, today);
  const canReview = data.plan.endDate.slice(0, 7) >= thisMonth;
  const locked = month < thisMonth;
  const canAddBig = data.plan.endDate.slice(0, 7) >= thisMonth;
  const compareId = compare.startsWith("month:") ? "month" : compare;
  const panel = liveRow && (
    <LinePanel
      key={`${liveRow.key}|${month}`}
      row={liveRow}
      month={month}
      today={today}
      data={data}
      db={db}
      deps={deps}
      onChanged={changed}
      onClose={() => setOpenRow(null)}
      onAddBig={(line) => setBigEdit({ line })}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MonthBar
          nav={monthNav(month, today, firstMonth)}
          onChoose={(m) => {
            setMonth(m);
            setOpenRow(null);
          }}
        />
        <span className="text-sm text-muted-foreground">against</span>
        <Select
          value={compareId}
          onValueChange={(v) => setCompare(v === "month" ? (`month:${pastMonths[0]}` as CompareChoice) : (v as CompareChoice))}
          items={COMPARE_CHOICES.map((c) => ({ value: c.id, label: c.label }))}
        >
          <SelectTrigger aria-label="Compare against">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPARE_CHOICES.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {compareId === "month" && (
          <Select
            value={compare.slice("month:".length)}
            onValueChange={(v) => setCompare(`month:${v as string}` as CompareChoice)}
            items={pastMonths.map((m) => ({ value: m, label: formatPeriodLabel(m) }))}
          >
            <SelectTrigger aria-label="Which month">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pastMonths.map((m) => (
                <SelectItem key={m} value={m}>
                  {formatPeriodLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <ToggleGroup
          value={[sort]}
          onValueChange={(v: string[]) => {
            if (v[0]) setSort(v[0] as "group" | "change");
          }}
          variant="outline"
          size="sm"
          aria-label="Order"
        >
          <ToggleGroupItem value="group">By group</ToggleGroupItem>
          <ToggleGroupItem value="change">Biggest change first</ToggleGroupItem>
        </ToggleGroup>
        {canAddBig && (
          <Button variant="outline" size="sm" onClick={() => setBigEdit({})}>
            Add a big month
          </Button>
        )}
        {/* Only a budget whose year is not over can be reviewed. */}
        {canReview && (
          <Button variant="outline" size="sm" onClick={() => setSetup("review")}>
            Set up budget
          </Button>
        )}
        {/* From December 1, until next year's budget exists. */}
        {nextYear && nextYear === String(Number(data.plan.startDate.slice(0, 4)) + 1) && (
          <Button variant="outline" size="sm" onClick={() => setSetup("next-year")}>
            Start {nextYear} budget
          </Button>
        )}
      </div>

      {view.throughDay !== null && (
        <p className="text-sm text-muted-foreground">
          Compared on the same days: {formatDateRange(monthBounds(month).from, `${month}-${String(view.throughDay).padStart(2, "0")}`)} in each month.
        </p>
      )}

      <div className="w-full">
        <MonthTable
          view={view}
          showEmpty={showEmpty}
          openKey={liveRow?.key ?? null}
          openPanel={isMobile ? null : panel}
          onOpen={setOpenRow}
          onEditBig={(b) => setBigEdit({ initial: b })}
          onDeleteBig={setBigDelete}
          locked={locked}
        />
      </div>

      {view.hiddenCount > 0 && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowEmpty((s) => !s)}>
          {`${showEmpty ? "Hide" : "Show"} ${linesWord(view.hiddenCount)}`}
        </Button>
      )}

      <Sheet
        open={isMobile && !!liveRow}
        onOpenChange={(o) => {
          if (!o) setOpenRow(null);
        }}
      >
        <SheetContent side="bottom" showCloseButton={false} className="data-[side=bottom]:h-dvh overflow-y-auto motion-reduce:transition-none">
          <SheetTitle className="sr-only">{liveRow?.line ?? "Line"}</SheetTitle>
          {isMobile && panel}
        </SheetContent>
      </Sheet>

      {bigEdit && (
        <BigMonthDialog
          plan={data.plan}
          today={today}
          lines={view.sections.flatMap((s) => s.rows).filter((r) => r.side === "spending").map((r) => r.line)}
          initial={bigEdit.initial}
          presetLine={bigEdit.line}
          db={db}
          deps={deps}
          onClose={() => setBigEdit(null)}
          onSaved={changed}
        />
      )}
      {bigDelete && <DeleteBigMonth big={bigDelete} db={db} deps={deps} onClose={() => setBigDelete(null)} onDeleted={changed} />}
    </div>
  );
}
