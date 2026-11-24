// src/ui/what-if/LadderPanel.tsx
//
// The salary ladder on the What if screen, under the verdict as its explanation. Each
// of its two totals reads as an income statement: Gross pay; Federal income tax, Social
// Security and Medicare and Benefits, each estimated or from Settings; the charity pot
// (while one is on); = Take-home (after the pot, the only take-home); Expenses, the
// budget's lines with the Charity line left out; the what-if rows switched on; in all;
// = Left over or short. A Monthly | Yearly switch flips every line; it opens on Monthly
// and is remembered on this computer, the way the Dashboard remembers its compare
// choice. The salary each step needs stays one click away under each statement. Figures
// come straight from whatIfLadder; the rows are switched on the list beside it, not
// here. No motion.
//
// Your income first: the same income statement at the real salary (the what-if's own,
// else the current yearly salary), so Left over is a true number: Gross pay less tax,
// benefits and the pot is Take-home; Take-home less Expenses and every
// row switched on is Left over. The two break-even totals moved below it, into one
// section, Salary you would need, that starts collapsed. Expenses fold open and shut on
// every statement at once. Both choices are remembered on this computer, like Monthly | Yearly.
import { Fragment, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import InfoPoint from "../help/InfoPoint";
import { termShown } from "../../help/glossary";
import { useRememberedOpen } from "../lib/useRememberedOpen";
import { formatCents, formatWholeDollars } from "../../domain/money";
import { isShort, type IncomeStatement, type StatementView } from "../../domain/income-statement";
import type { LadderRung, WhatIfLadder, YourIncome } from "../../domain/what-if";

export interface LadderPanelProps {
  ladder: WhatIfLadder;
}

/** Where the Monthly | Yearly choice is remembered (this browser only; reads and writes may throw). */
export const LADDER_VIEW_KEY = "finance.whatIf.ladderView";

function storedView(): StatementView {
  try {
    return window.localStorage.getItem(LADDER_VIEW_KEY) === "yearly" ? "yearly" : "monthly";
  } catch {
    return "monthly";
  }
}

function rememberView(v: StatementView): void {
  try {
    window.localStorage.setItem(LADDER_VIEW_KEY, v);
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}

/** Where the Expenses fold and the Salary you would need section are remembered (this browser only). */
export const EXPENSES_OPEN_KEY = "finance.whatIf.expensesOpen";
export const NEEDED_OPEN_KEY = "finance.whatIf.salaryNeededOpen";
export const BENEFITS_OPEN_KEY = "finance.whatIf.benefitsOpen";

const UNIT: Record<StatementView, string> = { monthly: "a month", yearly: "a year" };
const PER: Record<StatementView, number> = { monthly: 1, yearly: 12 };

/** The lines that carry their own definition. "In all" is what the top bar calls Take-home needed. */
const TERM_OF: Partial<Record<string, string>> = { "take-home": "take-home", maaser: "maaser", "in-all": "take-home-needed" };

/** Take-home needed (net), a month and a year. */
const monthAndYear = (annualCents: number) => `${formatWholeDollars(Math.round(annualCents / 12))} a month (${formatWholeDollars(annualCents)} a year)`;

function Rung({ rung, view }: { rung: LadderRung; view: StatementView }) {
  const cost = rung.monthlyCents * PER[view];
  return (
    <li data-testid="ladder-rung" data-rung-id={rung.id} className="grid grid-cols-[1fr_auto] gap-x-3 border-b py-1.5 last:border-b-0">
      <span className="min-w-0 truncate">{rung.label}</span>
      <span data-testid="rung-salary" className="text-right font-mono tabular-nums">{formatWholeDollars(rung.salaryAfterCents)} a year</span>
      <span className="text-muted-foreground">
        {rung.kind === "start" ? `${formatCents(cost)} ${UNIT[view]}` : `${cost < 0 ? "-" : "+"}${formatCents(Math.abs(cost))} ${UNIT[view]}`}
      </span>
      {/* The step's increase, named in full for a screen reader. */}
      <span
        data-testid="rung-added"
        aria-label={rung.kind === "start" ? undefined : `${rung.salaryAddedCents < 0 ? "Saves" : "Adds"} ${formatWholeDollars(Math.abs(rung.salaryAddedCents))} a year of salary`}
        className="text-right font-mono text-xs tabular-nums text-muted-foreground"
      >
        {rung.kind === "start" ? "" : `${rung.salaryAddedCents < 0 ? "-" : "+"}${formatWholeDollars(Math.abs(rung.salaryAddedCents))}`}
      </span>
      <span data-testid="rung-take-home" className="col-span-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
        Take-home {monthAndYear(rung.takeHomeAfterCents)}
      </span>
      {rung.note && <span className="col-span-2 text-xs text-muted-foreground">{rung.note}</span>}
    </li>
  );
}

/** The steps behind one line, one click away. */
function Steps({ rungs, what, view }: { rungs: LadderRung[]; what: string; view: StatementView }) {
  const [open, setOpen] = useState(false);
  if (rungs.length === 0) return null;
  const touchesCharity = rungs.some((r) => (r.charityDeltaCents ?? 0) !== 0);
  return (
    <div className="flex flex-col pb-1 pl-3">
      <Button variant="ghost" size="sm" className="self-start px-0 text-muted-foreground" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        {open ? `Hide the ${what}` : `Show the ${what} (${rungs.length})`}
      </Button>
      {open && (
        <>
          <p className="text-xs text-muted-foreground">Each step's cost, then the yearly base salary needed (gross) once it is added, and the take-home (net) it leaves after tax, benefits and the charity pot.</p>
          {touchesCharity && <p className="text-xs text-muted-foreground">A change to the Charity line moves the line above Take-home, not Expenses.</p>}
          <ol className="flex flex-col">
            {rungs.map((r) => (
              <Rung key={r.id} rung={r} view={view} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function Statement({
  title, equals = true, grossCents, grossTestId, termId, statement, view, testId, note, stepsAfter, steps, stepsWhat, expensesOpen, onExpensesOpen, benefitsOpen, onBenefitsOpen,
}: {
  title: string;
  /** "= Salary to live": a total the app works out. False for the user's own salary, which is typed. */
  equals?: boolean;
  grossCents: number;
  grossTestId: string;
  termId: string;
  statement: IncomeStatement;
  view: StatementView;
  testId: string;
  note?: string;
  stepsAfter: string;
  steps: LadderRung[];
  stepsWhat: string;
  expensesOpen: boolean;
  onExpensesOpen: (open: boolean) => void;
  benefitsOpen: boolean;
  onBenefitsOpen: (open: boolean) => void;
}) {
  const short = isShort(statement);
  const lines = statement[view];
  const expensesCents = lines.filter((l) => l.id.startsWith("expense:")).reduce((sum, l) => sum + l.cents, 0);
  return (
    <section data-testid={testId} className="flex flex-col border-t pt-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 font-medium">
        <span className="flex items-center gap-1">
          {equals ? "= " : ""}
          {title} (gross)
          <InfoPoint termId={termId} />
          {note && (
            <span data-testid="goals-included-note" className="text-xs font-normal text-muted-foreground">
              {note}
            </span>
          )}
        </span>
        <span data-testid={grossTestId} className="font-mono tabular-nums">
          {formatWholeDollars(grossCents)} a year
        </span>
      </div>
      <div className="flex flex-col pt-1">
        {lines.map((l) => (
          <Fragment key={l.id}>
            {l.id.startsWith("expense:") && !expensesOpen ? null : l.id === "expenses" ? (
              // Expenses fold open and shut; shut, the heading carries their sum.
              <button
                type="button"
                data-testid="statement-heading"
                data-line={l.id}
                aria-expanded={expensesOpen}
                onClick={() => onExpensesOpen(!expensesOpen)}
                className="flex items-center justify-between gap-x-3 pt-1.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                <span className="flex items-center gap-1">
                  {expensesOpen ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
                  <span data-testid="statement-label">{l.label}</span>
                </span>
                {!expensesOpen && (
                  <span data-testid="expenses-shut-total" className="font-mono normal-case tracking-normal tabular-nums">
                    {formatCents(expensesCents)}
                  </span>
                )}
              </button>
            ) : l.heading ? (
              // A group's heading (Expenses; What-if rows switched on): no figure of its own.
              <div data-testid="statement-heading" data-line={l.id} className="pt-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <span data-testid="statement-label">{l.label}</span>
              </div>
            ) : (
              /* Wraps on a phone rather than pushing the page sideways. */
              <div
                data-testid="statement-line"
                data-line={l.id}
                className={`flex flex-wrap items-baseline justify-between gap-x-3 py-0.5 ${l.total || l.subtotal ? "border-t font-medium" : l.id.startsWith("expense:") || l.id.startsWith("row:") ? "pl-6" : "pl-3"}`}
              >
                <span className="flex items-center gap-1">
                  {l.items ? (
                    // The benefits the user lists fold open and shut under their line.
                    <button type="button" aria-expanded={benefitsOpen} onClick={() => onBenefitsOpen(!benefitsOpen)} className="flex items-center gap-1 text-left hover:text-muted-foreground">
                      {benefitsOpen ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
                      <span data-testid="statement-label">{l.label}</span>
                    </button>
                  ) : (
                    <span data-testid="statement-label">{l.label}</span>
                  )}
                  {TERM_OF[l.id] && termShown(TERM_OF[l.id]!) && <InfoPoint termId={TERM_OF[l.id]!} />}
                </span>
                {/* Minus for money out; red only for a real shortfall. */}
                <span data-testid="statement-value" className={`ml-auto font-mono tabular-nums ${l.id === "left-over" && short ? "text-destructive" : ""}`}>
                  {formatCents(l.cents)}
                </span>
              </div>
            )}
            {l.items && benefitsOpen && (
              <ul data-testid="benefit-items" className="flex flex-col">
                {l.items.map((i) => (
                  <li key={i.label} data-testid="benefit-item" className="flex flex-wrap items-baseline justify-between gap-x-3 py-0.5 pl-6 text-muted-foreground">
                    <span>{i.label}</span>
                    <span className="ml-auto font-mono tabular-nums">{formatCents(i.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
            {l.id === stepsAfter && <Steps rungs={steps} what={stepsWhat} view={view} />}
          </Fragment>
        ))}
      </div>
      {statement.notes.map((n) => (
        <p key={n} data-testid="statement-note" className="text-xs text-muted-foreground">
          {n}
        </p>
      ))}
    </section>
  );
}

/** Your income: the user's real salary as an income statement, or why there is none. */
type Folds = { expensesOpen: boolean; onExpensesOpen: (open: boolean) => void; benefitsOpen: boolean; onBenefitsOpen: (open: boolean) => void };

function YourIncomeStatement({ yourIncome, view, folds }: { yourIncome: YourIncome | null | undefined; view: StatementView; folds: Folds }) {
  if (!yourIncome)
    return (
      <p data-testid="your-income-missing" className="border-t pt-2 text-muted-foreground">
        Type a yearly base salary under Settings, Salary, or give this what-if a salary, to see what is left over each month.
      </p>
    );
  return (
    <Statement
      title={yourIncome.whose === "current" ? "Your current salary" : "This what-if's salary"}
      equals={false}
      grossCents={yourIncome.grossAnnualCents}
      grossTestId="your-income-gross"
      termId={yourIncome.whose === "current" ? "current-salary" : "salary-ladder"}
      statement={yourIncome.statement}
      view={view}
      testId="statement-your-income"
      stepsAfter=""
      steps={[]}
      stepsWhat=""
      {...folds}
    />
  );
}

export default function LadderPanel({ ladder }: LadderPanelProps) {
  const [view, setView] = useState<StatementView>(storedView);
  const [expensesOpen, setExpensesOpen] = useRememberedOpen(EXPENSES_OPEN_KEY, true);
  const [neededOpen, setNeededOpen] = useRememberedOpen(NEEDED_OPEN_KEY, false);
  const [benefitsOpen, setBenefitsOpen] = useRememberedOpen(BENEFITS_OPEN_KEY, true);
  const folds = { expensesOpen, onExpensesOpen: setExpensesOpen, benefitsOpen, onBenefitsOpen: setBenefitsOpen };
  const costRungs = ladder.rungs.filter((r) => r.kind !== "goal");
  const goalRungs = ladder.rungs.filter((r) => r.kind === "goal");
  const choose = (v: StatementView) => {
    setView(v);
    rememberView(v);
  };

  return (
    <div data-testid="ladder-panel-root" className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-muted-foreground">
          <p data-testid="price-month">Priced for a usual month: each budget line's every-month amount, with every row that is switched on.</p>
          <InfoPoint termId="price-month" />
        </div>
        <ToggleGroup
          value={[view]}
          onValueChange={(v: unknown[]) => {
            if (v.length > 0) choose(v[0] as StatementView);
          }}
          aria-label="Show the ladder"
          variant="outline"
          size="sm"
          spacing={0}
        >
          <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
          <ToggleGroupItem value="yearly">Yearly</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <p className="text-xs text-muted-foreground">
        Your salary as an income statement, {UNIT[view]}: Take-home, less your expenses and every row switched on, is what is left over. One-time costs and down payments are paid once and never count here.
      </p>

      {ladder.statements && (
        <>
          <YourIncomeStatement yourIncome={ladder.statements.yourIncome} view={view} folds={folds} />

          <section data-testid="salary-needed-section" className="flex flex-col gap-2 border-t pt-2">
            <Button variant="ghost" size="sm" className="self-start px-0" aria-expanded={neededOpen} onClick={() => setNeededOpen(!neededOpen)}>
              {neededOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
              Salary you would need
            </Button>
            {!neededOpen && (
              <p data-testid="salary-needed-summary" className="text-xs text-muted-foreground">
                To live: {formatWholeDollars(ladder.salaryToLiveCents)} a year. To live and hit goals: {formatWholeDollars(ladder.salaryToLiveAndHitGoalsCents)} a year.
              </p>
            )}
            {neededOpen && (
              <>
                <p className="text-xs text-muted-foreground">
                  The yearly base salary that just covers each total, so Left over is about zero. It is rounded to the whole dollar, so Left over is a few cents either way.
                </p>
                <Statement
                  title="Salary to live"
                  grossCents={ladder.salaryToLiveCents}
                  grossTestId="salary-to-live"
                  termId="salary-to-live"
                  statement={ladder.statements.toLive}
                  view={view}
                  testId="statement-to-live"
                  stepsAfter="in-all"
                  steps={costRungs}
                  stepsWhat="salary each step needs"
                  {...folds}
                />
                <Statement
                  title="Salary to live and hit goals"
                  grossCents={ladder.salaryToLiveAndHitGoalsCents}
                  grossTestId="salary-to-live-and-goals"
                  termId="salary-to-live-and-hit-goals"
                  statement={ladder.statements.toLiveAndHitGoals}
                  view={view}
                  testId="statement-to-live-and-goals"
                  note={goalRungs.length === 0 ? "No goals included" : undefined}
                  stepsAfter="in-all"
                  steps={goalRungs}
                  stepsWhat="salary each goal saving needs"
                  {...folds}
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
