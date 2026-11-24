// src/ui/goals/GoalCard.tsx -- one goal, the way Monarch's goal card reads:
// template, name, status pill, saved amount, "% of target", progress bar,
// target month with months ahead/behind, then the planned / needed / finish /
// this-month rows and the linked accounts. Pure view over GoalStatus and
// GoalFunding (src/domain/goals.ts); no math here.
import {
  AlertCircleIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckCircle2Icon,
  CircleCheckBigIcon,
  CircleDashedIcon,
  LandmarkIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";

import type { GoalFunding, GoalStatus, GoalStatusKind } from "../../domain/plan-types";
import { formatProgressPct, goalSavingPlan, goalTargetText, goalTemplateLabel } from "../../domain/goals";
import { formatWholeDollars } from "../../domain/money";
import { formatMonthShort, formatPeriodLabel, periodOf } from "../../domain/period";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export const STATUS_LABEL: Record<GoalStatusKind, string> = {
  completed: "Completed",
  fully_saved: "Fully saved",
  ahead: "Ahead",
  on_track: "On track",
  at_risk: "At risk",
  no_plan: "No plan yet",
};

export function StatusPill({ status, archived }: { status: GoalStatusKind; archived: boolean }) {
  if (archived) return <Badge variant="secondary">Archived</Badge>;
  if (status === "at_risk") {
    return (
      <Badge variant="outline" className="border-destructive text-destructive">
        <AlertCircleIcon className="size-3" />
        {STATUS_LABEL[status]}
      </Badge>
    );
  }
  if (status === "no_plan") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <CircleDashedIcon className="size-3" />
        {STATUS_LABEL[status]}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-positive text-positive">
      <CheckCircle2Icon className="size-3" />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** "Target January 2027 (2 months behind)" / "Target January 2027" / "No target date". */
/**
 * What the goal's saving row saves on What if: the
 * Planned per month the user typed, with the month it is fully saved at that pace, or
 * else what the target date needs.
 */
export function whatIfLine(status: GoalStatus): string {
  const plan = goalSavingPlan(status);
  if (plan.source === "done") return "On What if: nothing more to save.";
  if (plan.source === "none" || plan.monthlyCents === null) return "On What if: saves nothing until it has a target date or a planned amount.";
  if (plan.source === "planned") {
    const finish = plan.finishPeriod ? `, fully saved by ${formatMonthShort(plan.finishPeriod)}` : ", which does not finish within 50 years";
    return `On What if: saves your planned ${formatWholeDollars(plan.monthlyCents)} a month${finish}.`;
  }
  const by = plan.finishPeriod ? ` (${formatMonthShort(plan.finishPeriod)})` : "";
  return `On What if: saves ${formatWholeDollars(plan.monthlyCents)} a month, worked out from the target date${by}.`;
}

export function targetLine(status: GoalStatus): string {
  const g = status.goal;
  if (!g.targetDate) return "No target date";
  const label = `Target ${formatPeriodLabel(periodOf(g.targetDate))}`;
  const v = status.monthsVsTarget;
  if (v === null || v === 0 || status.status === "completed" || status.status === "fully_saved") return label;
  const n = Math.abs(v);
  return `${label} (${n} ${n === 1 ? "month" : "months"} ${v < 0 ? "ahead" : "behind"})`;
}

/** What the "Projected finish" row says. */
export function finishLine(status: GoalStatus): string {
  if (status.status === "completed") return "Completed";
  if (status.status === "fully_saved") return "Fully saved";
  if (status.forecastPeriod) return formatPeriodLabel(status.forecastPeriod);
  if (status.goal.plannedMonthlyCents <= 0) return "Set a monthly plan to see a date";
  return "More than 50 years";
}

export interface GoalCardProps {
  status: GoalStatus;
  funding: GoalFunding;
  /** Links cannot be edited while the account list is unknown (a failed load). */
  accountsAvailable: boolean;
  busy: boolean;
  onEdit: () => void;
  onAccounts: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  /** Start this cost. The button shows only when given. */
  onStartCost?: () => void;
  /** Mark complete / Unmark complete. The buttons show only when given. */
  onMarkComplete?: () => void;
  onUnmarkComplete?: () => void;
}

export default function GoalCard({ status, funding, accountsAvailable, busy, onEdit, onAccounts, onArchive, onUnarchive, onDelete, onStartCost, onMarkComplete, onUnmarkComplete }: GoalCardProps) {
  const goal = status.goal;
  const archived = !!goal.archivedAt;
  const nothingLeft = status.status === "completed" || status.status === "fully_saved";
  const cost = goal.ongoingMonthlyCents ?? 0;
  const started = !!goal.ongoingStartedPeriod;
  // What the cost line says.
  const costLine =
    cost <= 0
      ? null
      : started
        ? `${formatWholeDollars(cost)} a month, in your budget as ${goal.ongoingBudgetLine ?? goal.name} since ${formatMonthShort(goal.ongoingStartedPeriod as string)}`
        : `Then ${formatWholeDollars(cost)} a month`;
  const needed =
    status.recommendedMonthlyCents !== null
      ? formatWholeDollars(status.recommendedMonthlyCents)
      : status.status === "completed" || status.status === "fully_saved"
        ? "Nothing"
        : goal.targetDate
          ? ""
          : "Needs a target date";

  return (
    <Card data-testid={`goal-card-${goal.id}`} className={archived ? "opacity-80" : undefined}>
      <CardHeader>
        {/* min-w-0 on both the grid item and the flex child so a long name
            truncates instead of pushing the pill past the card edge. */}
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardDescription>{goalTemplateLabel(goal.goalType)}</CardDescription>
            <CardTitle className="truncate" title={goal.name}>
              {goal.name}
            </CardTitle>
          </div>
          <StatusPill status={status.status} archived={archived} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          {/* The savings target leads; the monthly amount is the smaller line. */}
          <span data-testid={`goal-target-line-${goal.id}`} className="font-heading text-xl font-semibold tabular-nums">
            {goalTargetText(goal)}
          </span>
          {!nothingLeft && status.recommendedMonthlyCents !== null && status.recommendedMonthlyCents > 0 && (
            <span data-testid={`goal-monthly-line-${goal.id}`} className="text-sm text-muted-foreground tabular-nums">
              About {formatWholeDollars(status.recommendedMonthlyCents)} a month to get there
            </span>
          )}
          {costLine && (
            <span data-testid={`goal-cost-line-${goal.id}`} className="text-sm tabular-nums">
              {costLine}
            </span>
          )}
          {/* Its saving row on What if, set up here once. An archived goal is not on What if. */}
          {!archived && (
            <span data-testid={`goal-whatif-line-${goal.id}`} className="text-sm text-muted-foreground tabular-nums">
              {whatIfLine(status)}
            </span>
          )}
          <Progress value={status.progressPct * 100} aria-label={`${goal.name} progress`}>
            <div className="flex w-full items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {formatWholeDollars(status.savedCents)} saved, {formatProgressPct(status.progressPct)} of {formatWholeDollars(goal.targetAmountCents)}
              </span>
              <span className="text-muted-foreground">{targetLine(status)}</span>
            </div>
          </Progress>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Planned per month</dt>
          <dd className="text-right font-medium tabular-nums">{goal.plannedMonthlyCents > 0 ? formatWholeDollars(goal.plannedMonthlyCents) : "Not set"}</dd>
          <dt className="text-muted-foreground">Needed per month</dt>
          <dd className="text-right font-medium tabular-nums">{needed}</dd>
          <dt className="text-muted-foreground">Projected finish</dt>
          <dd className="text-right font-medium tabular-nums">{finishLine(status)}</dd>
          <dt className="text-muted-foreground" title="Net money moved into this goal's entire-balance accounts this month">
            This month
          </dt>
          <dd className="text-right font-medium tabular-nums">{status.thisMonthCents !== null ? formatWholeDollars(status.thisMonthCents) : ""}</dd>
        </dl>

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Funded by</span>
          {funding.byAccount.length === 0 && funding.outsideCents === 0 && <span className="text-muted-foreground">No linked accounts yet</span>}
          {funding.byAccount.map((line) => (
            <div key={line.accountId} className="flex items-center justify-between gap-2">
              <span className="truncate">
                <LandmarkIcon className="mr-1 inline size-3.5 text-muted-foreground" aria-hidden />
                {line.accountName}
                <span className="text-muted-foreground"> · {line.mode === "entire" ? "entire balance" : "fixed amount"}</span>
              </span>
              <span className="tabular-nums">{line.balanceKnown ? formatWholeDollars(line.cents) : "No balance yet"}</span>
            </div>
          ))}
          {funding.outsideCents > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Saved outside linked accounts</span>
              <span className="tabular-nums">{formatWholeDollars(funding.outsideCents)}</span>
            </div>
          )}
          {funding.ignoredAccountIds.length > 0 && (
            <span className="text-destructive">
              {funding.ignoredAccountIds.length === 1 ? "1 linked account no longer counts" : `${funding.ignoredAccountIds.length} linked accounts no longer count`}{" "}
              (archived or not a savings-type account).
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {archived ? (
            <Button variant="outline" size="sm" onClick={onUnarchive} disabled={busy} aria-label={`Unarchive ${goal.name}`}>
              <ArchiveRestoreIcon className="size-3.5" />
              Unarchive
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onEdit} disabled={busy} aria-label={`Edit ${goal.name}`}>
                <PencilIcon className="size-3.5" />
                Edit
              </Button>
              <Button variant="outline" size="sm" onClick={onAccounts} disabled={busy || !accountsAvailable} aria-label={`Accounts for ${goal.name}`}>
                <LandmarkIcon className="size-3.5" />
                Accounts
              </Button>
              {onStartCost && cost > 0 && !started && (
                <Button variant="outline" size="sm" onClick={onStartCost} disabled={busy} aria-label={`Start this cost for ${goal.name}`}>
                  <PlayIcon className="size-3.5" />
                  Start this cost
                </Button>
              )}
              {goal.completedAt
                ? onUnmarkComplete && (
                    <Button variant="outline" size="sm" onClick={onUnmarkComplete} disabled={busy} aria-label={`Unmark ${goal.name} complete`}>
                      <Undo2Icon className="size-3.5" />
                      Unmark complete
                    </Button>
                  )
                : onMarkComplete && (
                    <Button variant="outline" size="sm" onClick={onMarkComplete} disabled={busy} aria-label={`Mark ${goal.name} complete`}>
                      <CircleCheckBigIcon className="size-3.5" />
                      Mark complete
                    </Button>
                  )}
              <Button variant="outline" size="sm" onClick={onArchive} disabled={busy} aria-label={`Archive ${goal.name}`}>
                <ArchiveIcon className="size-3.5" />
                Archive
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={onDelete} disabled={busy} aria-label={`Delete ${goal.name}`}>
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
