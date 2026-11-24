// src/ui/budget/LinePanel.tsx -- one line's panel: 12 months of bars, the figures, Change budget, See transactions, Go back to
// suggested, the note for the open month, this line's changes, and the fixed-cost switch.
// On a month before this month the budget is locked: history and the note only.
import { useEffect, useMemo, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatCents } from "../../domain/money";
import { formatPeriodLabel, formatShortDate, monthBounds } from "../../domain/period";
import { MAASER_CATEGORY, maaserLedgerView, potAccountIds, type MaaserFigure } from "../../domain/maaser-pot";
import { potLabel } from "../../domain/charity-pot";
import { displayAccountName } from "../../domain/account-display";
import { lineChangesIn } from "../../domain/budget-changes";
import { lineFigures, type MonthRow } from "../../domain/budget-month";
import { PAYCHECKS_LINE } from "../../domain/budget-income";
import type { LineSuggestion } from "../../domain/suggest";
import type { BudgetChange } from "../../domain/plan-types";
import type { Db } from "../lib/db";
import { ledgerHref } from "../lib/ledger-link";
import type { BudgetData, BudgetDataLayer } from "./useBudgetData";
import LineChart from "./LineChart";
import LineNote from "./LineNote";
import ChangeBudget from "./ChangeBudget";
import GoBackDialog from "./GoBackDialog";
import PanelBudgetBox from "./PanelBudgetBox";

const CADENCE_WORDS = { weekly: "every week", biweekly: "every 2 weeks", monthly: "every month", quarterly: "every 3 months", annual: "every year" } as const;

export function changeWords(c: BudgetChange, goalName?: string): string {
  const from = `from ${formatPeriodLabel(c.fromMonth)}`;
  return c.reason === "goal"
    ? `${formatCents(c.amountCents)} ${from}, goal: ${goalName ?? "a goal"}`
    : `${formatCents(c.amountCents)} ${from}, something changed`;
}

export interface LinePanelProps {
  row: MonthRow;
  month: string;
  today: string;
  data: BudgetData;
  db: Db;
  deps: BudgetDataLayer;
  onChanged: () => void;
  onClose: () => void;
  onAddBig: (line: string) => void;
  /** The Year tab's click on a future month: Change budget opens with "From [that month] on". */
  startFrom?: string;
}

export default function LinePanel({ row, month, today, data, db, deps, onChanged, onClose, onAddBig, startFrom }: LinePanelProps) {
  const thisMonth = today.slice(0, 7);
  // Locked: a month before this month, or any month of a budget year that is over (the server refuses both).
  const locked = month < thisMonth || data.plan.endDate.slice(0, 7) < thisMonth;
  const figures = useMemo(() => lineFigures(data, row.line, row.side, month, today), [data, row.line, row.side, month, today]);
  const { changed, goals } = lineChangesIn(data.changes, row.line);
  const everyMonth = data.lines.find((l) => l.planningCategory === row.line && l.period === null && l.origin !== "change");
  const goalName = (id: string | null) => data.goals.find((g) => g.id === id)?.name;
  const isPaychecks = row.side === "income" && row.line === PAYCHECKS_LINE;
  // The charity pot: the Charity line's panel shows the pot's ledger, and every figure opens the rows
  // behind it. With the pot off there is no ledger.
  const isCharity = row.side === "spending" && row.line === MAASER_CATEGORY;
  const potName = potLabel(data.salary.pot);
  // All time, from the first row the app holds to today: what is owed is a running total, not a year's.
  const ledgerSpan = useMemo(() => {
    const first = data.prepared.reduce((min, t) => (t.date < min ? t.date : min), today).slice(0, 10);
    return { from: first, to: today };
  }, [data.prepared, today]);
  const pot = useMemo(
    () =>
      isCharity
        ? maaserLedgerView({
            accounts: data.accounts, prepared: data.prepared, mapping: data.mapping, marks: data.maaserMarks,
            maaserRate: data.salary.maaserRate, pot: data.salary.pot, floorCents: data.maaserFloorCents, ...ledgerSpan,
          })
        : null,
    [isCharity, data, ledgerSpan],
  );
  const drill = (label: string, figures: MaaserFigure[]) =>
    ledgerHref({ label, back: "#/budget/month", maaser: figures, ...ledgerSpan, transfers: "include", countedAccountsOnly: false, view: "maaser" });
  const [editing, setEditing] = useState(startFrom !== undefined);
  const [goingBack, setGoingBack] = useState(false);
  const [suggestion, setSuggestion] = useState<LineSuggestion | null>(null);
  const [fixed, setFixed] = useState(row.fixed);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (row.side !== "spending") return;
    let cancelled = false;
    deps
      .getLineSuggestion(db, data.plan.id, row.line)
      .then((s) => {
        if (!cancelled) setSuggestion(s);
      })
      .catch(() => {
        // The bill figure is extra; the panel works without it.
      });
    return () => {
      cancelled = true;
    };
  }, [deps, db, data.plan.id, row.line, row.side, fixed]);

  const name = formatPeriodLabel(month).split(" ")[0];
  const bills = suggestion?.basis.kind === "bill" ? suggestion.basis.bills : [];
  const figuresList: [string, string][] = [[month === thisMonth ? `${name} so far` : name, formatCents(figures.monthCents)]];
  if (figures.headingForCents !== null) figuresList.push(["Heading for", formatCents(figures.headingForCents)]);
  if (figures.lastMonthCents !== null) figuresList.push(["Last month", formatCents(figures.lastMonthCents)]);
  if (figures.highest) figuresList.push(["Highest month", `${formatCents(figures.highest.cents)} in ${formatPeriodLabel(figures.highest.month)}`]);
  if (figures.avg3 !== null) figuresList.push(["3-month average", formatCents(figures.avg3)]);
  if (figures.avg12 !== null) figuresList.push(["12-month average", formatCents(figures.avg12)]);
  if (fixed) for (const b of bills) figuresList.push(["Bill", `${b.label}: ${formatCents(b.usualCents)} ${CADENCE_WORDS[b.cadence]}`]);

  const toggleFixed = async (next: boolean) => {
    setError(null);
    try {
      await deps.setCategoryRecurring(db, row.line, next);
      setFixed(next);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const seeHref = ledgerHref({
    label: row.line,
    back: "#/budget/month",
    categories: [row.line],
    kind: row.side === "income" ? "income" : "expense",
    ...monthBounds(month),
  });

  return (
    <section
      aria-label={row.line}
      className="flex flex-col gap-4 rounded-lg border bg-card p-4 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none"
    >
      {/* The budget box first: from the month the user is looking at on. */}
      {!locked && !isPaychecks && <PanelBudgetBox row={row} from={startFrom ?? month} data={data} db={db} deps={deps} onChanged={onChanged} />}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{row.line}</h3>
          <p className="text-sm text-muted-foreground">12 months to {formatPeriodLabel(month)}</p>
        </div>
        <div className="flex items-center gap-3">
          {row.side === "spending" && (
            <label className="flex items-center gap-2 text-sm">
              <Switch size="sm" checked={fixed} onCheckedChange={(c: boolean) => void toggleFixed(c)} />
              Fixed cost
            </label>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <LineChart figures={figures} line={row.line} side={row.side} />
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1 text-sm">
          {figuresList.map(([k, v]) => (
            <div key={k + v} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {isCharity && pot && <MaaserLedgerGroup pot={pot} name={potName} fixed={!!data.salary.pot && data.salary.pot.kind !== "percent"} today={today} since={ledgerSpan.from} drill={drill} accountHref={pot.account ? ledgerHref({ label: `The ${potName} account: ${displayAccountName(pot.account.name)}`, back: "#/budget/month", accountIds: [...potAccountIds(data.accounts)], transfers: "include", countedAccountsOnly: false, view: "account" }) : null} />}

      <div className="flex flex-wrap gap-2">
        {!locked && !isPaychecks && !editing && (
          <Button size="sm" onClick={() => setEditing(true)}>
            Change budget
          </Button>
        )}
        <a className={buttonVariants({ variant: "outline", size: "sm" })} href={seeHref}>
          See transactions
        </a>
        {!locked && row.setByYou && (
          <Button size="sm" variant="outline" onClick={() => setGoingBack(true)}>
            {row.side === "income" ? "Clear budget" : "Go back to suggested"}
          </Button>
        )}
        {!locked && row.side === "spending" && (
          <Button size="sm" variant="ghost" onClick={() => onAddBig(row.line)}>
            Add a big month
          </Button>
        )}
      </div>

      {editing && !locked && !isPaychecks && (
        <ChangeBudget
          row={{ ...row, fixed }}
          today={today}
          startFrom={startFrom ?? thisMonth}
          data={data}
          db={db}
          deps={deps}
          bills={bills}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      <LineNote
        key={`${month}|${row.note ?? ""}`}
        month={month}
        note={row.note}
        onSave={async (text) => {
          await deps.setMonthNote(db, data.plan.id, row.line, month, text);
          onChanged();
        }}
      />

      {(changed.length > 0 || goals.length > 0 || everyMonth?.source === "you") && (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">This line's changes in {data.plan.startDate.slice(0, 4)}</span>
          <ul className="text-sm">
            {everyMonth?.source === "you" && <li>{formatCents(everyMonth.amountCents)} every month, set by you</li>}
            {[...changed, ...goals]
              .sort((a, b) => a.fromMonth.localeCompare(b.fromMonth))
              .map((c) => (
                <li key={c.id}>{changeWords(c, goalName(c.goalId))}</li>
              ))}
          </ul>
        </div>
      )}

      {goingBack && (
        <GoBackDialog
          row={row}
          data={data}
          db={db}
          deps={deps}
          onClose={() => setGoingBack(false)}
          onDone={() => {
            setGoingBack(false);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

const FIG_LINK = "underline decoration-dotted underline-offset-4 hover:decoration-solid";

/**
 * The pot's ledger for all time: the two judgment figures first and large, then the list. Every figure
 * opens the rows behind it. With no pot account picked: what is owed against what was given, no balance.
 */
function MaaserLedgerGroup({ pot, name, fixed, today, since, drill, accountHref }: { pot: NonNullable<ReturnType<typeof maaserLedgerView>>; name: string; fixed: boolean; today: string; since: string; drill: (label: string, figures: MaaserFigure[]) => string; accountHref: string | null }) {
  const l = pot.ledger;
  // A set amount is owed whatever the income; a share of pay is owed from it.
  const owedLabel = fixed ? "Owed" : "Owed from income";
  const sinceWords = `since ${formatPeriodLabel(since.slice(0, 7))}, when your records begin`;
  if (!pot.account || accountHref === null) {
    const left = l.owedCents - l.givenFromCardsCents;
    return (
      <section role="group" aria-label={`${name} ledger`} data-testid="pot-ledger" className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 text-sm">
        <span className="font-medium">The {name} ledger</span>
        <p className="text-xs text-muted-foreground">{`What ${name} owes against what you gave, ${sinceWords}. Pick the account you set it aside in, under Settings, Accounts, to see what is set aside and the balance.`}</p>
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          {[
            { label: owedLabel, value: formatCents(l.owedCents), href: drill(owedLabel, ["income"]) },
            { label: "Given", value: formatCents(l.givenFromCardsCents), href: drill("Given", ["givenCards"]) },
            { label: left < 0 ? "Given ahead by" : "Still to give", value: formatCents(Math.abs(left)), href: drill(left < 0 ? "Given ahead by" : "Still to give", ["income", "givenCards"]) },
          ].map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="tabular-nums sm:text-right"><a className={FIG_LINK} href={f.href}>{f.value}</a></dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  const owes = l.potOwesYouCents < 0 ? ["Paid back ahead by", Math.abs(l.potOwesYouCents)] as const : ["The pot owes you", l.potOwesYouCents] as const;
  const notYet = l.notYetSetAsideCents < 0 ? ["Set aside ahead by", Math.abs(l.notYetSetAsideCents)] as const : ["Not yet set aside", l.notYetSetAsideCents] as const;
  const owesHref = drill(owes[0], ["givenCards", "reimbursed"]);
  const list: { label: string; value: string; href: string; hint?: string }[] = [
    {
      label: `${name} available`,
      value: pot.availableCents === null ? "No balance from the bank yet" : formatCents(pot.availableCents),
      href: accountHref,
      hint: pot.balanceCents !== null ? `balance ${formatCents(pot.balanceCents)}${pot.balanceDate ? ` on ${formatShortDate(pot.balanceDate, today)}` : ""} less the ${formatCents(pot.floorCents)} floor` : undefined,
    },
    { label: owedLabel, value: formatCents(l.owedCents), href: drill(owedLabel, ["income"]) },
    { label: "Set aside", value: formatCents(l.setAsideCents), href: drill("Set aside", ["setAside"]) },
    { label: notYet[0], value: formatCents(notYet[1]), href: drill(notYet[0], ["income", "setAside"]) },
    { label: "Given, from your cards and checking", value: formatCents(l.givenFromCardsCents), href: drill("Given, from your cards and checking", ["givenCards"]) },
    { label: "Given, straight from the pot", value: formatCents(l.givenFromPotCents), href: drill("Given, straight from the pot", ["givenPot"]) },
    { label: "Paid back from the pot", value: formatCents(l.reimbursedCents), href: drill("Paid back from the pot", ["reimbursed"]) },
  ];
  return (
    <section role="group" aria-label={`${name} ledger`} data-testid="pot-ledger" className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 text-sm">
      <span className="font-medium">The {name} ledger: {displayAccountName(pot.account.name)}</span>
      <p className="text-xs text-muted-foreground">{`Spent on this line is what reached a charity this month. The figures below are the ${name} ledger ${sinceWords}.`}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">{owes[0]}</div>
          <div className="text-xl font-semibold tabular-nums"><a className={FIG_LINK} href={owesHref}>{formatCents(owes[1])}</a></div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-xs text-muted-foreground">Given beyond {name}</div>
          <div className="text-xl font-semibold tabular-nums">
            {l.beyondMaaserCents === null ? <span className="text-sm font-normal text-muted-foreground">No balance from the bank yet</span> : <a className={FIG_LINK} href={drill(`Given beyond ${name}`, ["givenCards", "reimbursed"])}>{formatCents(l.beyondMaaserCents)}</a>}
          </div>
        </div>
      </div>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        {list.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className="tabular-nums sm:text-right">
              <a className={FIG_LINK} href={f.href}>{f.value}</a>
              {f.hint && <span className="block text-xs text-muted-foreground">{f.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
