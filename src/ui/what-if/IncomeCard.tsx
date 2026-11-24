// src/ui/what-if/IncomeCard.tsx
//
// The income a what-if models. It starts from
// the saved values and the section remounts it (by key) whenever the saved what-if
// changes, so there is no copying step that could overwrite a click made while the
// screen loads.
//
// Real income lives in Settings, Salary now, so a
// what-if with no salary of its own keeps the current salary ("Current salary",
// which used to read None). Its own salary's start month may stay empty: it then
// starts with the current salary. It can also carry its own
// additional salary, or None, in place of the one in Settings. The
// choice of additional salary is a native select, like the what-if picker above it.
//
// It folds open and shut, open at first and remembered on this
// computer; shut, one line names the salary the what-if counts.
import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents, parseDollarsToCents } from "../../domain/money";
import { formatMonthShort } from "../../domain/period";
import { additionalSalaryProblem, type AdditionalSalary, type CurrentSalary } from "../../domain/income";
import type { WhatIf } from "../../domain/what-if";
import { useRememberedOpen } from "../lib/useRememberedOpen";

/** Where the card's open or shut choice is remembered (this browser only). */
export const INCOME_OPEN_KEY = "finance.whatIf.incomeOpen";

export interface IncomeCardProps {
  whatIf: WhatIf;
  busy: boolean;
  /** The user's current salary from Settings, Salary, to name what the what-if keeps. */
  currentSalary?: CurrentSalary | null;
  /** Save a salary (null = keep the current one), its start month (null = the current salary's), and the additional salary. */
  onSave: (salaryGrossAnnualCents: number | null, salaryFromPeriod: string | null, additional: WhatIf["additionalSalary"]) => Promise<boolean>;
}

/** "150,000" for 15,000,000 cents: whole dollars with commas, for the salary box. */
const wholeDollarsText = (cents: number) => Math.round(cents / 100).toLocaleString("en-US");

type OtherChoice = "same" | "none" | "w2" | "monthly";

function describeCurrent(c: CurrentSalary | null | undefined): string {
  if (!c) return "No current salary is set in Settings, Salary.";
  const amount = c.kind === "gross" ? `$${wholeDollarsText(c.grossAnnualCents)} a year` : `${formatCents(c.monthlyCents)} a month after tax`;
  return `Settings, Salary: ${amount}, from ${formatMonthShort(c.fromPeriod)}.`;
}

export default function IncomeCard({ whatIf, busy, currentSalary = null, onSave }: IncomeCardProps) {
  const [incomeOn, setIncomeOn] = useState(whatIf.salaryGrossAnnualCents !== null);
  const [salaryText, setSalaryText] = useState(whatIf.salaryGrossAnnualCents !== null ? wholeDollarsText(whatIf.salaryGrossAnnualCents) : "");
  const [salaryFrom, setSalaryFrom] = useState(whatIf.salaryFromPeriod ?? "");
  const saved = whatIf.additionalSalary ?? null;
  const [other, setOther] = useState<OtherChoice>(saved === null ? "same" : saved === "none" ? "none" : saved.kind);
  const [otherText, setOtherText] = useState(
    saved && saved !== "none" ? (saved.kind === "w2" ? wholeDollarsText(saved.grossAnnualCents) : formatCents(saved.monthlyCents).replace("$", "")) : ""
  );
  const [otherFrom, setOtherFrom] = useState(saved && saved !== "none" ? saved.fromPeriod : "");
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useRememberedOpen(INCOME_OPEN_KEY, true);

  /** The additional salary as typed, or the reason it cannot be saved. */
  const additional = (): { ok: WhatIf["additionalSalary"] } | { problem: string } => {
    if (other === "same") return { ok: null };
    if (other === "none") return { ok: "none" };
    let cents: number;
    try {
      cents = parseDollarsToCents(otherText);
    } catch {
      return { problem: other === "w2" ? "Type the additional salary as dollars a year, for example 60,000." : "Type the additional amount as dollars a month." };
    }
    const a: AdditionalSalary = other === "w2" ? { kind: "w2", grossAnnualCents: cents, fromPeriod: otherFrom } : { kind: "monthly", monthlyCents: cents, fromPeriod: otherFrom };
    const p = additionalSalaryProblem(a);
    return p ? { problem: p } : { ok: a };
  };

  const save = async () => {
    const extra = additional();
    if ("problem" in extra) return setProblem(extra.problem);
    if (!incomeOn) {
      setProblem(null);
      await onSave(null, null, extra.ok);
      return;
    }
    let cents: number;
    try {
      cents = parseDollarsToCents(salaryText);
    } catch {
      return setProblem("Type the salary as dollars a year, for example 150,000.");
    }
    if (!(cents > 0)) return setProblem("Type the salary as dollars a year, for example 150,000.");
    setProblem(null);
    // An empty month starts with the current salary.
    await onSave(cents, salaryFrom || null, extra.ok);
  };

  const chooseCurrent = async () => {
    if (whatIf.salaryGrossAnnualCents === null) {
      setIncomeOn(false);
      return;
    }
    setProblem(null);
    // The radio moves only once the save that clears the
    // salary has actually gone through; a refused save leaves it on A different
    // salary, with the salary still there to try again.
    const ok = await onSave(null, null, whatIf.additionalSalary ?? null);
    if (ok) setIncomeOn(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1 text-left hover:text-muted-foreground">
            {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
            Income while this is on
          </button>
        </CardTitle>
        {open ? (
          <CardDescription>
            Base salary only; a bonus is never counted. It moves the Forecast, and its charity share raises Monthly budget; Salary needed stays what you would need.
          </CardDescription>
        ) : (
          <CardDescription data-testid="income-shut-summary">
            {whatIf.salaryGrossAnnualCents === null
              ? `Current salary. ${describeCurrent(currentSalary)}`
              : `A different salary: $${wholeDollarsText(whatIf.salaryGrossAnnualCents)} a year${whatIf.salaryFromPeriod ? `, from ${formatMonthShort(whatIf.salaryFromPeriod)}` : ""}.`}
          </CardDescription>
        )}
      </CardHeader>
      {open && (
        <CardContent className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="wi-income" checked={!incomeOn} onChange={() => void chooseCurrent()} disabled={busy} />
            Current salary
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="wi-income" checked={incomeOn} onChange={() => setIncomeOn(true)} disabled={busy} />
            A different salary
          </label>
          {!incomeOn && <p className="basis-full text-xs text-muted-foreground">{describeCurrent(currentSalary)}</p>}
          {incomeOn && (
            <>
              <div className="grid gap-1">
                <Label htmlFor="wi-salary">Yearly base salary</Label>
                <Input id="wi-salary" inputMode="decimal" className="w-36 font-mono" value={salaryText} onChange={(e) => setSalaryText(e.target.value)} placeholder="150,000" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="wi-salary-from">Salary starts</Label>
                {/* At 390px, w-40 (10rem) left the year
                    clipped behind the browser's calendar icon; w-44 gives it room. */}
                <Input id="wi-salary-from" type="month" className="w-44" value={salaryFrom} onChange={(e) => setSalaryFrom(e.target.value)} />
              </div>
              <p className="basis-full text-xs text-muted-foreground">Leave Salary starts empty to start it when your current salary starts.</p>
            </>
          )}
  
          <div className="flex basis-full flex-wrap items-end gap-3 border-t pt-3">
            <div className="grid gap-1">
              <Label htmlFor="wi-additional">Additional salary while this is on</Label>
              <select
                id="wi-additional"
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={other}
                onChange={(e) => setOther(e.target.value as OtherChoice)}
                disabled={busy}
              >
                <option value="same">Same as Settings, Salary</option>
                <option value="none">None</option>
                <option value="w2">W-2 salary, taxed with yours</option>
                <option value="monthly">Monthly amount</option>
              </select>
            </div>
            {(other === "w2" || other === "monthly") && (
              <>
                <div className="grid gap-1">
                  <Label htmlFor="wi-additional-amount">{other === "w2" ? "Additional yearly salary" : "Additional monthly amount"}</Label>
                  <Input id="wi-additional-amount" inputMode="decimal" className="w-36 font-mono" value={otherText} onChange={(e) => setOtherText(e.target.value)} placeholder={other === "w2" ? "60,000" : "2,000.00"} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="wi-additional-from">Additional salary starts</Label>
                  <Input id="wi-additional-from" type="month" className="w-44" value={otherFrom} onChange={(e) => setOtherFrom(e.target.value)} />
                </div>
              </>
            )}
          </div>
  
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            Save income
          </Button>
          {problem && (
            <p role="alert" className="basis-full text-destructive">
              {problem}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
