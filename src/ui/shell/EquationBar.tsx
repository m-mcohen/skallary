// src/ui/shell/EquationBar.tsx
//
// The top of every screen as one statement that adds up on screen: into the bank,
// less the charity pot's amount put away (only while the pot is on), less the budget,
// equals left over, for this month or the budget year.
// Spent so far sits under the budget term; the pay steps sit behind the "into the
// bank" info point. On a phone it folds to the result; on a desktop it
// folds to one line on request.
//
// Presentational only: it takes the summary's statement and renders it.
import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { formatCents, formatWholeDollars } from "../../domain/money";
import { formatPeriodLabel } from "../../domain/period";
import type { StatementLine } from "../../domain/income-statement";
import type { EquationTerms } from "../../domain/equation";
import type { MastheadSummary } from "../lib/instrument";
import InfoPoint from "../help/InfoPoint";
import { SetUpCard } from "../setup/SetUpCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";

export interface EquationBarProps {
  equation: MastheadSummary["equation"];
  /** Set while a what-if is on: every term follows it, and the bar says so. */
  scenarioLabel?: string | null;
  /** The local server cannot be reached: the shell's Not connected banner explains. */
  unavailable?: boolean;
  /** The transactions could not be read: say so in one line instead of showing the loading block. */
  unreadable?: boolean;
  /** Desktop only: folded to one line. AppShell owns it through useEquationBarCollapsed. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

type View = "month" | "year";
const VIEW_KEY = "equation-bar-view";
const OPEN_KEY = "equation-bar-open";
const COLLAPSED_KEY = "equation-bar-collapsed";

// Browser storage can be missing or throw (private window, blocked site data): a per-device convenience only.
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered; the bar still works.
  }
}

const FIGURE = "font-mono tabular-nums text-xl font-semibold leading-tight";
const LABEL = "block text-xs leading-tight text-muted-foreground";
const NOT_KNOWN = "–";
// A figure that has just changed rises into place, so the switch shows what moved (animate skill:
// state indication, 200 ms strong ease-out, 40 ms stagger; reduced motion keeps only the fade).
const ENTER =
  "inline-block transition-[opacity,translate] duration-200 ease-ui-out starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0";

/** A figure; callers key it on the period shown, so a switch brings it in fresh. */
function Fig({ view, order, className = "", children }: { view: View; order: number; className?: string; children: React.ReactNode }) {
  return (
    <span data-testid="eq-figure" data-enter={view} className={`${ENTER} ${className}`} style={{ transitionDelay: `${order * 40}ms` }}>
      {children}
    </span>
  );
}

function PaySteps({ lines, estimated, taxSetUpNeeded }: { lines: StatementLine[] | null; estimated: boolean; taxSetUpNeeded?: boolean }) {
  if (!lines) return null;
  // Estimated taxes need the tax step first: the card stands in for the steps, never a guess.
  if (estimated && taxSetUpNeeded) {
    return (
      <div data-testid="pay-steps" className="border-t pt-2">
        <SetUpCard step="tax" what="These steps estimate federal tax, which needs your filing status and children." />
      </div>
    );
  }
  return (
    <dl data-testid="pay-steps" className="flex flex-col gap-0.5 border-t pt-2 text-sm font-normal">
      {lines.map((l) => (
        <div key={l.id} className={`flex justify-between gap-3 ${l.total ? "border-t pt-1 font-medium" : ""}`}>
          <dt>{l.label}</dt>
          <dd className="font-mono tabular-nums">{formatCents(l.cents)}</dd>
        </div>
      ))}
      {estimated && (
        <p className="pt-1 text-xs text-muted-foreground">
          Some lines are estimates; figures typed from your pay stub in <a className="underline underline-offset-4" href="#/settings/salary">Settings, Salary</a> replace them. State and local taxes are not estimated.
        </p>
      )}
    </dl>
  );
}

/** "budget", "budget, incl. holiday groceries +$650", or "budget, incl. 3 big months +$1,950". */
function budgetLabel(t: EquationTerms): string {
  if (t.bigMonths.length === 0) return "budget";
  const total = formatWholeDollars(t.bigMonths.reduce((s, b) => s + b.cents, 0));
  return t.bigMonths.length === 1 ? `budget, incl. ${t.bigMonths[0].label} +${total}` : `budget, incl. ${t.bigMonths.length} big months +${total}`;
}

/** "$2,400.00 spent so far", with the overspend in words when there is one. */
function spentText(t: EquationTerms): string {
  const over = t.spentSoFarCents - t.spentAgainstCents;
  const base = `${formatCents(t.spentSoFarCents)} spent so far`;
  return over > 0 ? `${base}, over by ${formatCents(over)}` : base;
}

function SpentBar({ t, className = "w-48" }: { t: EquationTerms; className?: string }) {
  // The scale runs to whichever is larger, so the value never passes the maximum when over budget
  // (the bar reads full either way); the words carry the overspend.
  const max = Math.max(t.spentSoFarCents, t.spentAgainstCents, 1);
  const over = t.spentSoFarCents - t.spentAgainstCents;
  const text = `${formatCents(t.spentSoFarCents)} spent of ${formatCents(t.spentAgainstCents)}${over > 0 ? `, over by ${formatCents(over)}` : ""}`;
  return <Progress value={Math.max(0, t.spentSoFarCents)} max={max} aria-label="Spent so far" aria-valuetext={text} className={`mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/10 ${className}`} />;
}

/** Month | Year as a two-tab switch: a dark thumb slides to the one that is on. It sits
 *  inside the bar's Tabs root, and the figures are its panel. */
function PeriodSwitch() {
  return (
    <span className="shrink-0">
      <TabsList aria-label="Month or year" className="relative isolate h-9 bg-muted">
        <TabsPrimitive.Indicator
          data-testid="eq-thumb"
          className="absolute top-1/2 left-0 -z-10 h-[calc(100%-6px)] w-(--active-tab-width) translate-x-(--active-tab-left) -translate-y-1/2 rounded-md bg-foreground transition-[translate,width] duration-250 ease-ui-move motion-reduce:transition-none"
        />
        {(["month", "year"] as const).map((v) => (
          <TabsTrigger
            key={v}
            value={v}
            className="w-16 transition-colors duration-200 data-active:bg-transparent! data-active:text-background! data-active:shadow-none!"
          >
            {v === "month" ? "Month" : "Year"}
          </TabsTrigger>
        ))}
      </TabsList>
    </span>
  );
}

/** Whether the desktop bar is folded to one line, remembered on this device. AppShell owns it, because the
 *  sidebar's top edge follows the bar's height. */
export function useEquationBarCollapsed(): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => readStored(COLLAPSED_KEY) === "true");
  const set = (c: boolean) => {
    setCollapsed(c);
    writeStored(COLLAPSED_KEY, String(c));
  };
  return [collapsed, set];
}

export default function EquationBar({
  equation,
  scenarioLabel,
  unavailable = false,
  unreadable = false,
  collapsed = false,
  onCollapsedChange,
}: EquationBarProps) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>(() => (readStored(VIEW_KEY) === "year" ? "year" : "month"));
  const [open, setOpen] = useState<boolean>(() => readStored(OPEN_KEY) === "true");

  const emptyHeight = collapsed && !isMobile ? "h-12" : "h-16";
  if (!equation && unreadable) {
    // A failed read is not loading, and not zero: say what is missing and what to do.
    return (
      <div data-testid="equation-bar" className={`flex ${collapsed && !isMobile ? "min-h-12" : "min-h-16"} items-center border-b bg-muted/30 px-4 py-2`}>
        <p className="text-sm text-muted-foreground">Couldn&apos;t read your transactions, so the figures across the top are missing. Reload, or press Sync.</p>
      </div>
    );
  }
  if (!equation && unavailable) return <div data-testid="equation-bar" className={`flex ${emptyHeight} items-center border-b bg-muted/30 px-4`} />;
  if (!equation) {
    // Before the first read lands: a skeleton, never a zero (a zero is a claim about the money).
    return (
      <div data-testid="equation-bar" className={`flex ${emptyHeight} items-center border-b bg-muted/30 px-4`}>
        <Skeleton data-testid="equation-loading" className="h-3 w-96" />
      </div>
    );
  }

  const year = equation.year;
  // The pot's term shows only while the pot is on (null: off).
  const potShown = equation.potName !== null;
  const shown: View = view === "year" && year ? "year" : "month";
  const other: View | null = year ? (shown === "year" ? "month" : "year") : null;
  const m = equation.month;
  const pick = (v: View) => {
    setView(v);
    writeStored(VIEW_KEY, v);
  };
  const toggleOpen = () => {
    setOpen((o) => {
      writeStored(OPEN_KEY, String(!o));
      return !o;
    });
  };
  const switcher = year ? <PeriodSwitch /> : null;
  // With a year to switch to, the bar is the Tabs root and the figures are the shown period's panel; without one,
  // plain elements. Plain functions, not components, so a re-render never remounts the figures.
  const root = (className: string, children: React.ReactNode) =>
    year ? (
      <TabsPrimitive.Root value={shown} onValueChange={(v) => pick(v as View)} data-testid="equation-bar" className={`group/tabs ${className}`}>
        {children}
      </TabsPrimitive.Root>
    ) : (
      <div data-testid="equation-bar" className={className}>
        {children}
      </div>
    );
  const panel = (className: string, children: React.ReactNode) =>
    year ? (
      <TabsPrimitive.Panel value={shown} data-testid="eq-main" className={className}>
        {children}
      </TabsPrimitive.Panel>
    ) : (
      <div data-testid="eq-main" className={className}>
        {children}
      </div>
    );

  // The terms for one period. The bar draws the shown period, and on a desktop also the other one, invisible,
  // in the same cell, so each cell is as wide as its wider figure and nothing moves on a switch.
  function termsFor(v: View, ghost: boolean) {
    const t: EquationTerms = v === "year" ? year! : m;
    const id = (name: string) => (ghost ? undefined : `eq-${name}`);
    const leftTone = t.leftOverCents === null ? "text-muted-foreground" : t.leftOverCents < 0 ? "text-destructive" : "";
    const fig = (order: number, className: string, children: React.ReactNode) =>
      ghost ? (
        <span className={`inline-block ${className}`}>{children}</span>
      ) : (
        <Fig key={v} view={v} order={order} className={className}>
          {children}
        </Fig>
      );
    const periodName = v === "year" ? year!.year : formatPeriodLabel(m.month);
    const periodNote = v === "year" ? (year!.mixedNote ?? "whole year") : m.day !== null ? `day ${m.day} of ${m.daysInMonth}` : "";
    const steps = v === "year" ? equation!.paySteps.yearly : equation!.paySteps.monthly;
    const estimated = v === "year" ? equation!.paySteps.estimated.yearly : equation!.paySteps.estimated.monthly;
    const noSalaryFor = m.noSalaryMonth && m.noSalaryMonth !== m.month ? `add ${formatPeriodLabel(m.noSalaryMonth)} in` : "add it in";
    const leftFigure = fig(4, `${FIGURE} ${leftTone}`, t.leftOverCents === null ? NOT_KNOWN : formatCents(t.leftOverCents));
    return {
      t,
      periodName,
      leftTone,
      leftFigure,
      period: (
        <span data-testid={id("period")} className="whitespace-nowrap">
          {fig(0, "text-base font-semibold leading-tight", periodName)}
          {periodNote && <span className={LABEL}>{periodNote}</span>}
        </span>
      ),
      bank:
        t.bankCents === null ? (
          <span data-testid={id("bank")} className="whitespace-nowrap">
            {fig(1, FIGURE, "No salary")}
            <span className={LABEL}>
              {noSalaryFor}{" "}
              <a className="underline underline-offset-4" href="#/settings/salary">
                Settings, Salary
              </a>
            </span>
          </span>
        ) : (
          <span data-testid={id("bank")} className="whitespace-nowrap">
            {fig(1, FIGURE, formatCents(t.bankCents))}{" "}
            <InfoPoint termId="into-the-bank">
              <PaySteps lines={steps} estimated={estimated} taxSetUpNeeded={equation!.taxSetUpNeeded} />
            </InfoPoint>
            <span className={LABEL}>
              into the bank
              {v === "year" && year!.monthsWithoutPay.length > 0 && `, no salary in ${year!.monthsWithoutPay.map((x) => formatPeriodLabel(x).split(" ")[0]).join(", ")}`}
            </span>
          </span>
        ),
      maaser: potShown ? (
        <span data-testid={id("maaser")} className="whitespace-nowrap">
          {fig(2, `${FIGURE} ${t.maaserCents === null ? "text-muted-foreground" : ""}`, t.maaserCents === null ? NOT_KNOWN : formatCents(t.maaserCents))}
          <span className={LABEL}>{equation!.potName ?? "charity"}, put away</span>
        </span>
      ) : null,
      budget: (
        <span data-testid={id("budget")} className="whitespace-nowrap">
          {fig(3, FIGURE, formatCents(t.budgetCents))}
          <span className={LABEL}>{budgetLabel(t)}</span>
          {/* Spent so far on its own line beside its bar, so the budget cell stays narrow. */}
          <span className="mt-0.5 flex items-center gap-2">
            <SpentBar t={t} className="mt-0 w-20" />
            <span className="text-xs leading-tight text-muted-foreground">{spentText(t)}</span>
          </span>
        </span>
      ),
      left: (
        <span data-testid={id("left")} className="block whitespace-nowrap rounded-lg border bg-background px-3 py-1">
          {leftFigure}
          <span className={LABEL}>left over</span>
        </span>
      ),
    };
  }
  type Terms = ReturnType<typeof termsFor>;
  const now = termsFor(shown, false);
  const ghost: Terms | null = other ? termsFor(other, true) : null;
  /** One cell: the shown term, with the other period's drawn invisibly underneath to hold the width. */
  const cell = (name: "period" | "bank" | "maaser" | "budget" | "left") => (
    <span className="grid">
      <span className="[grid-area:1/1]">{now[name]}</span>
      {ghost && (
        <span data-ghost aria-hidden inert className="invisible [grid-area:1/1]">
          {ghost[name]}
        </span>
      )}
    </span>
  );

  const notes = (
    <>
      {scenarioLabel && (
        <span className="flex items-center gap-1 text-xs text-primary">
          What-if on: {scenarioLabel} <InfoPoint termId="overlay" />
        </span>
      )}
    </>
  );
  const op = (sign: string) => (
    <span className="text-xl font-light leading-tight text-muted-foreground" aria-hidden>
      {sign}
    </span>
  );

  if (isMobile) {
    return (
      root(
        "border-b bg-muted/30 px-4 py-3",
        <>
        <div className="flex items-center justify-between gap-3">
          <button type="button" aria-expanded={open} onClick={toggleOpen} className="flex min-w-0 items-center gap-2 text-left">
            <span className="min-w-0">
              {now.leftFigure}
              <span className={LABEL}>left over, {now.periodName}</span>
            </span>
            {open ? <ChevronUpIcon className="size-4 shrink-0" aria-hidden /> : <ChevronDownIcon className="size-4 shrink-0" aria-hidden />}
          </button>
          {switcher}
        </div>
        {panel(
          "outline-none",
          !open ? (
          <div className="mt-2">
            <SpentBar t={now.t} className="w-full" />
            <span className={`${LABEL} mt-1`}>
              Spent so far {formatCents(now.t.spentSoFarCents)} of {formatCents(now.t.spentAgainstCents)} · tap for the full equation
            </span>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {now.period}
            {now.bank}
            {now.maaser}
            {now.budget}
            {now.left}
            <div className="flex flex-col">{notes}</div>
          </div>
          ),
        )}
        </>,
      )
    );
  }

  const fold = (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Show the equation" : "Hide the equation"}
      onClick={() => onCollapsedChange?.(!collapsed)}
      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {collapsed ? <ChevronDownIcon className="size-4" aria-hidden /> : <ChevronUpIcon className="size-4" aria-hidden />}
    </button>
  );

  if (collapsed) {
    // Folded to one line: the period and what is left over, with the switch still in reach.
    return (
      root(
        "flex h-12 items-center justify-between gap-6 border-b bg-muted/30 px-4",
        <>
        <div className="flex min-w-0 items-center gap-6">
          {switcher}
          {panel(
            "min-w-0 overflow-x-auto outline-none",
          <span data-testid="eq-left" className="flex items-baseline gap-2 whitespace-nowrap">
            <span className="grid justify-items-end">
              <span className="[grid-area:1/1]">{now.leftFigure}</span>
              {ghost && (
                <span data-ghost aria-hidden inert className="invisible [grid-area:1/1]">
                  {ghost.leftFigure}
                </span>
              )}
            </span>
            <span className="text-sm text-muted-foreground">left over, {now.periodName}</span>
          </span>,
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div data-testid="eq-notes" className="flex shrink-0 flex-col items-end whitespace-nowrap">{notes}</div>
          {fold}
        </div>
        </>,
      )
    );
  }

  return (
    root(
      "flex h-16 items-center justify-between gap-4 border-b bg-muted/30 px-4 2xl:gap-6",
      <>
      <div className="flex min-w-0 items-center gap-4 2xl:gap-6">
        {switcher}
        {panel(
          "flex min-w-0 items-center gap-4 overflow-x-auto outline-none 2xl:gap-6",
          <>
        <span className="min-w-32">{cell("period")}</span>
        <div className="flex items-start gap-3 2xl:gap-4">
          {cell("bank")}
          {potShown && op("−")}
          {potShown && cell("maaser")}
          {op("−")}
          {cell("budget")}
          {op("=")}
          {cell("left")}
        </div>
          </>,
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div data-testid="eq-notes" className="flex shrink-0 flex-col items-end whitespace-nowrap">{notes}</div>
        {fold}
      </div>
      </>,
    )
  );
}
