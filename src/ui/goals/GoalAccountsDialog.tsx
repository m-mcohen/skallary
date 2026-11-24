// src/ui/goals/GoalAccountsDialog.tsx -- which accounts fund one goal, and
// how: not linked, the account's entire balance, or a fixed dollar slice.
// Monarch's rules, enforced here in plain language and again by the server:
// an account's entire balance funds only one goal; a fixed slice cannot
// exceed what the account still has available (its balance less every other
// goal's slices); an entire-balance account takes no slices.
//
// ToggleGroup per row rather than @shadcn/select, per AccountsSection.tsx's
// note on Base UI Select's jsdom click-through quirks.
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AccountFundingSummary, Goal, GoalAccountLink, GoalLinkMode } from "../../domain/plan-types";
import { formatCents, formatWholeDollars, parseDollarsToCents } from "../../domain/money";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type RowMode = "none" | GoalLinkMode;
export interface RowDraft {
  mode: RowMode;
  dollars: string;
}

export function rowDraftsFor(goalId: string, links: GoalAccountLink[]): Record<string, RowDraft> {
  const out: Record<string, RowDraft> = {};
  for (const l of links) {
    if (l.goalId !== goalId) continue;
    out[l.accountId] = { mode: l.mode, dollars: l.mode === "fixed" ? ((l.amountCents ?? 0) / 100).toFixed(2) : "" };
  }
  return out;
}

/**
 * The most this goal may take as a fixed slice of an account: the balance
 * less every OTHER goal's slices. Null when the balance is unknown (the app
 * cannot tell, so it does not pretend to).
 */
export function maxFixedCents(summary: AccountFundingSummary, goalId: string, links: GoalAccountLink[]): number | null {
  if (summary.balanceCents === null) return null;
  const others = links
    .filter((l) => l.accountId === summary.account.id && l.goalId !== goalId && l.mode === "fixed")
    .reduce((s, l) => s + (l.amountCents ?? 0), 0);
  return Math.max(summary.balanceCents - others, 0);
}

export interface GoalAccountsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: Goal | null;
  summaries: AccountFundingSummary[];
  /** Every goal's links, so the dialog can see what other goals already claim. */
  links: GoalAccountLink[];
  goalNames: Record<string, string>;
  onSave: (goalId: string, links: GoalAccountLink[]) => Promise<void>;
}

export default function GoalAccountsDialog({ open, onOpenChange, goal, summaries, links, goalNames, onSave }: GoalAccountsDialogProps) {
  const [rows, setRows] = useState<Record<string, RowDraft>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && goal) {
      setRows(rowDraftsFor(goal.id, links));
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?.id]);

  const setRow = useCallback((accountId: string, patch: Partial<RowDraft>) => {
    setRows((r) => {
      const prev: RowDraft = r[accountId] ?? { mode: "none", dollars: "" };
      return { ...r, [accountId]: { ...prev, ...patch } };
    });
  }, []);

  const maxById = useMemo(() => {
    const out: Record<string, number | null> = {};
    if (goal) for (const s of summaries) out[s.account.id] = maxFixedCents(s, goal.id, links);
    return out;
  }, [goal, summaries, links]);

  // This goal's links to accounts that are not listed because they cannot
  // fund a goal right now (Counted is off, or the account is archived). Save
  // keeps them untouched, so switching Counted back on restores the funding.
  const unlisted = useMemo(() => {
    if (!goal) return [];
    const listed = new Set(summaries.map((s) => s.account.id));
    return links.filter((l) => l.goalId === goal.id && !listed.has(l.accountId));
  }, [goal, summaries, links]);

  const handleSave = useCallback(async () => {
    if (!goal) return;
    setFormError(null);
    const next: GoalAccountLink[] = [...unlisted];
    for (const s of summaries) {
      const row = rows[s.account.id];
      if (!row || row.mode === "none") continue;
      if (row.mode === "entire") {
        next.push({ goalId: goal.id, accountId: s.account.id, mode: "entire", amountCents: null });
        continue;
      }
      let cents: number;
      try {
        cents = parseDollarsToCents(row.dollars || "0");
      } catch {
        setFormError(`${s.account.name}: enter a dollar amount.`);
        return;
      }
      if (cents < 0) {
        setFormError(`${s.account.name}: the amount cannot be negative.`);
        return;
      }
      const max = maxById[s.account.id];
      if (max !== null && cents > max) {
        // The one figure here that keeps its cents: it answers an amount the user typed to
        // the cent, so a rounded limit could read above what the user entered.
        setFormError(`${s.account.name}: only ${formatCents(max)} is available.`);
        return;
      }
      next.push({ goalId: goal.id, accountId: s.account.id, mode: "fixed", amountCents: cents });
    }
    setSaving(true);
    try {
      await onSave(goal.id, next);
      onOpenChange(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [goal, summaries, rows, maxById, unlisted, onSave, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Accounts for {goal?.name ?? "goal"}</DialogTitle>
          <DialogDescription>
            An account's entire balance follows the goal as it changes; a fixed amount is a slice you set by hand.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
          {summaries.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No accounts can fund a goal yet. Savings, checking, brokerage and retirement accounts with a type set will show here.
            </p>
          )}
          {summaries.map((s) => {
            const row = rows[s.account.id] ?? { mode: "none" as RowMode, dollars: "" };
            const takenBy = s.entireGoalId && goal && s.entireGoalId !== goal.id ? s.entireGoalId : null;
            const max = maxById[s.account.id];
            return (
              <div key={s.account.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.account.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {s.balanceCents === null ? "No balance synced yet" : `Balance ${formatWholeDollars(s.balanceCents)}`}
                      {takenBy
                        ? ` · Funds ${goalNames[takenBy] ?? "another goal"} entirely`
                        : max !== null
                          ? ` · ${formatWholeDollars(max)} available to this goal`
                          : ""}
                    </div>
                  </div>
                  <ToggleGroup
                    value={[row.mode]}
                    onValueChange={(v: string[]) => {
                      const next = (v[0] as RowMode | undefined) ?? "none";
                      setRow(s.account.id, { mode: next });
                    }}
                    aria-label={`How ${s.account.name} funds this goal`}
                    variant="outline"
                    size="sm"
                  >
                    {/* Not linked stays usable even when another goal holds the
                        entire balance, so a slice left over from before that
                        can still be removed here. */}
                    <ToggleGroupItem value="none" aria-label={`${s.account.name}: not linked`}>
                      Not linked
                    </ToggleGroupItem>
                    <ToggleGroupItem value="entire" disabled={!!takenBy} aria-label={`${s.account.name}: entire balance`}>
                      Entire balance
                    </ToggleGroupItem>
                    <ToggleGroupItem value="fixed" disabled={!!takenBy} aria-label={`${s.account.name}: fixed amount`}>
                      Fixed amount
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
                {row.mode === "fixed" && (
                  <Input
                    inputMode="decimal"
                    value={row.dollars}
                    onChange={(e) => setRow(s.account.id, { dollars: e.target.value })}
                    placeholder="$0.00"
                    aria-label={`${s.account.name}: fixed amount in dollars`}
                    className="sm:max-w-48"
                  />
                )}
              </div>
            );
          })}
          {unlisted.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {unlisted.length === 1
                ? "This goal is also linked to 1 account that cannot fund goals right now, because Counted is off or it is archived. That link is kept."
                : `This goal is also linked to ${unlisted.length} accounts that cannot fund goals right now, because Counted is off or they are archived. Those links are kept.`}
            </p>
          )}
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !goal}>
            {saving ? "Saving..." : "Save accounts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
