// src/ui/goals/GoalDialog.tsx -- add / edit one goal: template, name, target
// amount, optional target date, planned monthly contribution (with the
// "needed to finish on time" helper), amount saved outside linked accounts,
// priority, notes. Validation is the same plain-language set the server
// enforces (readService.normalizeGoal); a server refusal shows in the dialog.
//
// The template picker is a ToggleGroup rather than @shadcn/select for the
// reason AccountsSection.tsx records: Base UI's Select popup has jsdom
// click-through quirks in this suite, toggle buttons do not.
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Goal, GoalType } from "../../domain/plan-types";
import GoalPaymentHelper from "./GoalPaymentHelper";
import { getMortgageRatesUI, type MortgageRates } from "../lib/db";
import { GOAL_TEMPLATES, goalStatus } from "../../domain/goals";
import { formatWholeDollars, parseDollarsToCents } from "../../domain/money";

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
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { localDateIso } from "../../domain/period";

export interface GoalDraft {
  goalType: GoalType;
  name: string;
  targetDollars: string;
  targetDate: string;
  plannedDollars: string;
  outsideDollars: string;
  priority: string;
  notes: string;
  /** What the goal costs a month once reached; blank = none. */
  ongoingDollars: string;
}

export function draftFor(editing: Goal | null): GoalDraft {
  if (!editing) {
    return { goalType: "savings", name: "", targetDollars: "", targetDate: "", plannedDollars: "", outsideDollars: "", priority: "0", notes: "", ongoingDollars: "" };
  }
  return {
    goalType: editing.goalType,
    name: editing.name,
    targetDollars: (editing.targetAmountCents / 100).toFixed(2),
    targetDate: editing.targetDate ?? "",
    plannedDollars: editing.plannedMonthlyCents > 0 ? (editing.plannedMonthlyCents / 100).toFixed(2) : "",
    outsideDollars: editing.currentAmountCents > 0 ? (editing.currentAmountCents / 100).toFixed(2) : "",
    priority: String(editing.priority),
    notes: editing.notes,
    ongoingDollars: (editing.ongoingMonthlyCents ?? 0) > 0 ? ((editing.ongoingMonthlyCents as number) / 100).toFixed(2) : "",
  };
}

/**
 * Switching template pre-fills the name the way Monarch does, but never over
 * a name the user typed: only a blank name, or one still equal to the previous
 * template's default, is replaced.
 */
export function applyTemplate(draft: GoalDraft, next: GoalType): GoalDraft {
  const prevDefault = GOAL_TEMPLATES.find((t) => t.type === draft.goalType)?.defaultName ?? "";
  const nextDefault = GOAL_TEMPLATES.find((t) => t.type === next)?.defaultName ?? "";
  const untouched = draft.name.trim() === "" || draft.name === prevDefault;
  return { ...draft, goalType: next, name: untouched ? nextDefault : draft.name };
}

function newGoalId(): string {
  return `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Builds the Goal from a draft, or returns the first validation message. */
export function goalFromDraft(draft: GoalDraft, editing: Goal | null): { goal: Goal } | { error: string } {
  const name = draft.name.trim();
  if (!name) return { error: "Name is required." };
  let targetAmountCents: number;
  let plannedMonthlyCents: number;
  let currentAmountCents: number;
  let ongoingMonthlyCents: number;
  try {
    targetAmountCents = parseDollarsToCents(draft.targetDollars);
    plannedMonthlyCents = draft.plannedDollars.trim() ? parseDollarsToCents(draft.plannedDollars) : 0;
    currentAmountCents = draft.outsideDollars.trim() ? parseDollarsToCents(draft.outsideDollars) : 0;
    ongoingMonthlyCents = (draft.ongoingDollars ?? "").trim() ? parseDollarsToCents(draft.ongoingDollars) : 0;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid dollar amount." };
  }
  if (targetAmountCents <= 0) return { error: "Target amount must be greater than zero." };
  if (plannedMonthlyCents < 0) return { error: "Planned monthly contribution cannot be negative." };
  if (currentAmountCents < 0) return { error: "Saved outside linked accounts cannot be negative." };
  if (ongoingMonthlyCents < 0) return { error: "Ongoing cost a month cannot be negative." };
  const targetDate = draft.targetDate.trim();
  if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return { error: "Target date must be a date (YYYY-MM-DD) or blank." };
  const priority = Number.parseInt(draft.priority, 10);
  if (!Number.isFinite(priority)) return { error: "Priority must be a whole number." };
  return {
    goal: {
      id: editing?.id ?? newGoalId(),
      name,
      goalType: draft.goalType,
      targetAmountCents,
      targetDate: targetDate || null,
      priority,
      currentAmountCents,
      plannedMonthlyCents,
      notes: draft.notes.trim(),
      archivedAt: editing?.archivedAt ?? null,
      ongoingMonthlyCents,
      // Kept from the goal being edited: the dialog never starts, stops or
      // completes anything.
      ongoingStartedPeriod: editing?.ongoingStartedPeriod ?? null,
      ongoingBudgetLine: editing?.ongoingBudgetLine ?? null,
      completedAt: editing?.completedAt ?? null,
    },
  };
}

export interface GoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Goal | null;
  /** What the goal's linked accounts hold today (0 for a new goal); feeds the "needed per month" helper. */
  linkedCents: number;
  /**
   * What has landed this month in the goal's entire-balance accounts, exactly
   * as the card reads it (null for a new goal). The card skips this month once
   * money has arrived, so the helper must too or the two disagree.
   */
  thisMonthCents?: number | null;
  onSave: (goal: Goal) => Promise<void>;
  /** Today's mortgage rates for the payment helper; null when they cannot be had. */
  getRates?: () => Promise<MortgageRates | null>;
}

const defaultGetRates = () => getMortgageRatesUI({ base: "" });

function todayIso(): string {
  return localDateIso();
}

export default function GoalDialog({ open, onOpenChange, editing, linkedCents, thisMonthCents = null, onSave, getRates = defaultGetRates }: GoalDialogProps) {
  const [draft, setDraft] = useState<GoalDraft>(() => draftFor(editing));
  const [helperOpen, setHelperOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A fresh draft each time the dialog opens, for whichever goal it opens on.
  useEffect(() => {
    if (open) {
      setDraft(draftFor(editing));
      setFormError(null);
      setHelperOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  const set = useCallback(<K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) => setDraft((d) => ({ ...d, [key]: value })), []);

  // "Needed to finish on time": the same goalStatus() the cards use, over the draft.
  const needed = useMemo(() => {
    const built = goalFromDraft({ ...draft, plannedDollars: "" }, editing);
    if ("error" in built || !built.goal.targetDate) return null;
    return goalStatus(built.goal, linkedCents + built.goal.currentAmountCents, todayIso(), thisMonthCents).recommendedMonthlyCents;
  }, [draft, editing, linkedCents, thisMonthCents]);

  const handleSave = useCallback(async () => {
    setFormError(null);
    const built = goalFromDraft(draft, editing);
    if ("error" in built) {
      setFormError(built.error);
      return;
    }
    setSaving(true);
    try {
      await onSave(built.goal);
      onOpenChange(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [draft, editing, onSave, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit goal" : "Add goal"}</DialogTitle>
          <DialogDescription>
            A goal's savings are tracked here, and its saving a month is set up here for What if. On What if its saving and its ongoing cost are rows you switch on; the cost goes into your budget once you start it. Link accounts afterwards to fund the goal from real balances.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1.5">
            <Label>Template</Label>
            <ToggleGroup
              value={[draft.goalType]}
              onValueChange={(v: string[]) => {
                const next = v[0] as GoalType | undefined;
                if (next && next !== draft.goalType) setDraft((d) => applyTemplate(d, next));
              }}
              aria-label="Goal template"
              variant="outline"
              size="sm"
              className="flex-wrap"
            >
              {GOAL_TEMPLATES.map((t) => (
                <ToggleGroupItem key={t.type} value={t.type} aria-label={`Use the ${t.label} template`}>
                  {t.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-name">Name</Label>
            <Input id="goal-name" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Home renovations" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="goal-target">Target amount</Label>
              <Input id="goal-target" inputMode="decimal" value={draft.targetDollars} onChange={(e) => set("targetDollars", e.target.value)} placeholder="$0.00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="goal-date">Target date (optional)</Label>
              <Input id="goal-date" type="date" value={draft.targetDate} onChange={(e) => set("targetDate", e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-ongoing">Ongoing cost a month (optional)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="goal-ongoing"
                inputMode="decimal"
                value={draft.ongoingDollars}
                onChange={(e) => set("ongoingDollars", e.target.value)}
                placeholder="$0.00"
                readOnly={!!editing?.ongoingStartedPeriod}
              />
              {!editing?.ongoingStartedPeriod && (
                <Button type="button" variant="outline" size="sm" onClick={() => setHelperOpen((v) => !v)} aria-expanded={helperOpen}>
                  Work out the payment
                </Button>
              )}
            </div>
            {editing?.ongoingStartedPeriod ? (
              <span className="text-sm text-muted-foreground">This cost is in your budget. Change it on the Budget screen.</span>
            ) : (
              <span className="text-sm text-muted-foreground">What it costs a month once you have it, such as a mortgage or class fees.</span>
            )}
            {helperOpen && (
              <GoalPaymentHelper
                targetCents={(() => {
                  try {
                    return draft.targetDollars.trim() ? parseDollarsToCents(draft.targetDollars) : 0;
                  } catch {
                    return 0;
                  }
                })()}
                getRates={getRates}
                onUse={(cents) => {
                  set("ongoingDollars", (cents / 100).toFixed(2));
                  setHelperOpen(false);
                }}
              />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-planned">Planned per month</Label>
            <Input id="goal-planned" inputMode="decimal" value={draft.plannedDollars} onChange={(e) => set("plannedDollars", e.target.value)} placeholder="$0.00" />
            <span className="text-sm text-muted-foreground">What if saves this a month for the goal. Leave it blank to save what the target date needs.</span>
            {needed !== null && needed > 0 && (
              <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>Needed to finish on time: {formatWholeDollars(needed)} per month</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => set("plannedDollars", (needed / 100).toFixed(2))}>
                  Use this
                </Button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="goal-outside">Saved outside linked accounts</Label>
              <Input id="goal-outside" inputMode="decimal" value={draft.outsideDollars} onChange={(e) => set("outsideDollars", e.target.value)} placeholder="$0.00" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="goal-priority">Priority</Label>
              <Input id="goal-priority" type="number" value={draft.priority} onChange={(e) => set("priority", e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-notes">Notes (optional)</Label>
            <Input id="goal-notes" value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
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
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
