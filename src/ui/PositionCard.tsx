// src/ui/PositionCard.tsx -- the balance sheet: every account grouped the way a
// balance sheet groups them, footing to the same Drawable figure the top bar shows,
// with retirement held back below the line rather than hidden.
//
// Moved from NowSection.tsx: it was the Dashboard's
// Position card and is now Accounts, Balances. Unchanged except that it takes the
// accounts and balances as props instead of loading them.
import type { Account } from "../domain/types";
import type { AccountBalance } from "../domain/plan-types";
import { formatCents } from "../domain/money";
import { countsTowardDrawable, isCardAccount, isHeldBackAccount } from "../domain/runway";
import { displayAccountName } from "../domain/account-display";

import { ChevronDownIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** $ always and a minus sign for what is owed; a card balance is not a shortfall, so it is not red. */
const col = (c: number) => formatCents(c);

type Group = { key: string; label: string; rows: { name: string; cents: number }[]; total: number };

/**
 * Whether an account's balance is part of drawable: the same gate
 * drawableLiquidCents applies (src/domain/runway.ts), asked of the same
 * function, so the statement foots to the head's figure by construction.
 * The test still pins the two to each other.
 */
function counts(a: Account): boolean {
  return countsTowardDrawable(a);
}

/** A card's balance nets against cash whichever sign the feed reports it in. */
function contribution(a: Account, cents: number): number {
  return isCardAccount(a) ? -Math.abs(cents) : cents;
}

/**
 * Groups live accounts the way a balance sheet does. Cash, taxable
 * investments and card balances make up drawable. Everything the gate leaves
 * out is shown BELOW the line -- retirement as held back, anything else as
 * not counted -- so an exclusion reads as a decision rather than an omission.
 */
export function positionGroups(accounts: Account[], balances: AccountBalance[]) {
  const bal = (a: Account) =>
    balances.find((b) => b.accountId === a.id)?.balanceCents ?? a.balanceCents ?? null;
  const live = accounts.filter((a) => !a.archived && bal(a) !== null);

  const mk = (key: string, label: string, pick: (a: Account) => boolean): Group => {
    const rows = live
      .filter(pick)
      .map((a) => ({ name: displayAccountName(a.name), cents: contribution(a, bal(a)!) }))
      .sort((x, y) => y.cents - x.cents);
    return { key, label, rows, total: rows.reduce((s, r) => s + r.cents, 0) };
  };

  const cash = mk("cash", "Cash and deposits", (a) => counts(a) && a.type === "depository");
  const invest = mk("invest", "Investments, taxable", (a) => counts(a) && a.type === "brokerage");
  const cards = mk("cards", "Card balances", (a) => counts(a) && a.type === "credit");
  const other = mk("other", "Other", (a) => counts(a) && !["depository", "brokerage", "credit"].includes(a.type ?? ""));
  const held = mk("held", "Held back", (a) => isHeldBackAccount(a));
  const excluded = mk("excluded", "Not counted", (a) => !counts(a) && !isHeldBackAccount(a));

  const drawable = [cash, invest, cards, other].filter((g) => g.rows.length > 0);
  const drawableTotal = drawable.reduce((s, g) => s + g.total, 0);
  return { drawable, held, excluded, drawableTotal, allTotal: drawableTotal + held.total };
}

/** The bar's colors, in group order: the chart tokens, so a recolor is one edit in index.css. */
const BAR: Record<string, string> = {
  cash: "bg-chart-3",
  invest: "bg-chart-2",
  other: "bg-chart-4",
  held: "bg-chart-1",
};

/**
 * One card per group, each folding open and shut (ui-look, after Monarch), and a
 * Summary card beside them that foots to Drawable and All holdings.
 */
export function PositionCard({ accounts, balances }: { accounts: Account[]; balances: AccountBalance[] }) {
  const pos = positionGroups(accounts, balances);
  const below = [pos.held, pos.excluded].filter((g) => g.rows.length > 0);
  return (
    <div aria-label="Balances" className="grid items-start gap-section lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-section">
        {pos.drawable.map((g) => (
          <GroupCard key={g.key} group={g} />
        ))}
        {below.map((g) => (
          <GroupCard key={g.key} group={g} quiet />
        ))}
      </div>
      <SummaryCard pos={pos} />
    </div>
  );
}

function GroupCard({ group, quiet = false }: { group: Group; quiet?: boolean }) {
  return (
    <Card className="gap-0 py-0">
      <Collapsible defaultOpen>
        <CollapsibleTrigger className="group/trigger flex w-full items-center gap-3 px-(--card-spacing) py-5 text-left">
          <ChevronDownIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/trigger:rotate-0 -rotate-90 motion-reduce:transition-none"
          />
          <span className={`flex-1 text-lg font-medium ${quiet ? "text-muted-foreground" : ""}`}>{group.label}</span>
          <span className="font-mono text-lg tabular-nums">{col(group.total)}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul>
            {group.rows.map((r) => (
              <li key={r.name} className="flex items-center gap-4 border-t px-(--card-spacing) py-4">
                <span className="hidden size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground sm:flex">
                  {r.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1 text-sm break-words sm:text-base">{r.name}</span>
                <span className="font-mono text-sm tabular-nums sm:text-base">{col(r.cents)}</span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function SummaryCard({ pos }: { pos: ReturnType<typeof positionGroups> }) {
  const parts = [...pos.drawable.filter((g) => g.total > 0), pos.held].filter((g) => g.total > 0);
  const whole = parts.reduce((s, g) => s + g.total, 0) || 1;
  return (
    <Card className="order-first lg:sticky lg:top-4 lg:order-none">
      <CardHeader>
        <CardTitle className="text-lg">Summary</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex h-3 gap-1 overflow-hidden rounded-full" aria-hidden>
          {parts.map((g) => (
            <span key={g.key} className={`${BAR[g.key] ?? "bg-chart-5"} h-full rounded-full`} style={{ width: `${(g.total / whole) * 100}%` }} />
          ))}
        </div>
        <ul className="flex flex-col gap-3 text-sm">
          {pos.drawable.map((g) => (
            <li key={g.key} className="flex items-center gap-2">
              <span aria-hidden className={`size-2 rounded-full ${g.total > 0 ? (BAR[g.key] ?? "bg-chart-5") : "bg-muted-foreground"}`} />
              <span className="flex-1">{g.label}</span>
              <span className="font-mono tabular-nums">{col(g.total)}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between border-t pt-4">
          <span className="font-medium">Drawable</span>
          <span className="font-mono text-lg font-semibold tabular-nums" data-testid="position-drawable">
            {col(pos.drawableTotal)}
          </span>
        </div>
        {pos.held.rows.length > 0 && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span aria-hidden className={`size-2 rounded-full ${BAR.held}`} />
              <span className="flex-1">Held back</span>
              <span className="font-mono tabular-nums">{col(pos.held.total)}</span>
            </div>
            <div className="flex items-baseline justify-between border-t pt-4">
              <span className="font-medium">All holdings</span>
              <span className="font-mono text-lg font-semibold tabular-nums">{col(pos.allTotal)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
