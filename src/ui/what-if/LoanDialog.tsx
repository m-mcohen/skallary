// src/ui/what-if/LoanDialog.tsx
//
// The car and mortgage calculator on the What if screen:
// price, down payment, rate and years (and, for a mortgage, property tax and
// insurance a year). The payment a month uses the standard fixed-rate loan
// formula (src/domain/loan.ts), shown as the user types; the down payment is paid once,
// and reaches the Forecast, never the salary. No first-payment month: the Forecast starts the payments with the what-if's other
// costs and runs them the loan's years (open points 1 B and 2 A).
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents, parseDollarsToCents, percentInputValue } from "../../domain/money";
import { loanMonthlyCents, loanProblem, type LoanInputs, type WhatIfChange } from "../../domain/what-if";

export type LoanKind = "car" | "mortgage";

const DEFAULTS: Record<LoanKind, { title: string; label: string; line: string }> = {
  car: { title: "Car", label: "New car", line: "Car payment" },
  mortgage: { title: "Mortgage", label: "House", line: "Mortgage" },
};

export interface LoanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: LoanKind;
  editing: WhatIfChange | null;
  /** Next month, as YYYY-MM: stored on a new loan, never read. */
  defaultFrom: string;
  onSave: (change: Omit<WhatIfChange, "id" | "position">) => void;
  /** A save is running: Use this waits. */
  busy?: boolean;
  /** Why the last save was refused, shown here so it is not hidden behind the dialog. */
  saveError?: string | null;
}

const dollarsText = (cents: number | undefined) =>
  cents === undefined ? "" : (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * What Use this is waiting for, in plain words: "Type
 * the rate and the years to see the payment." for two missing fields, and so
 * on for one or three.
 */
function waitingFor(missing: string[]): string | null {
  if (missing.length === 0) return null;
  const withThe = missing.map((m) => `the ${m}`);
  if (withThe.length === 1) return `Type ${withThe[0]} to see the payment.`;
  const last = withThe[withThe.length - 1];
  const rest = withThe.slice(0, -1);
  return `Type ${rest.join(", ")} and ${last} to see the payment.`;
}

/** Money typed in a box: null while blank, a problem when unreadable. */
function money(text: string, what: string): { cents: number | null; problem: string | null } {
  if (text.trim() === "") return { cents: null, problem: null };
  try {
    return { cents: parseDollarsToCents(text), problem: null };
  } catch {
    return { cents: null, problem: `Type the ${what} as dollars, for example 35,000.` };
  }
}

export default function LoanDialog({ open, onOpenChange, kind, editing, defaultFrom, onSave, busy = false, saveError = null }: LoanDialogProps) {
  const d = DEFAULTS[kind];
  const [label, setLabel] = useState("");
  const [line, setLine] = useState("");
  const [price, setPrice] = useState("");
  const [down, setDown] = useState("");
  const [rate, setRate] = useState("");
  const [years, setYears] = useState("");
  const [tax, setTax] = useState("");
  const [insurance, setInsurance] = useState("");

  useEffect(() => {
    if (!open) return;
    const loan = editing?.loan;
    setLabel(editing?.label ?? d.label);
    setLine(editing?.planningCategory ?? d.line);
    setPrice(dollarsText(loan?.priceCents));
    setDown(dollarsText(loan?.downPaymentCents));
    setRate(loan ? percentInputValue(loan.annualRate) : "");
    setYears(loan ? String(loan.years) : "");
    setTax(dollarsText(loan?.propertyTaxYearCents));
    setInsurance(dollarsText(loan?.insuranceYearCents));
  }, [open, editing, d.label, d.line]);

  // The loan as typed so far: complete and sound, a problem in words, or what it is still waiting for.
  const status = useMemo((): { loan: LoanInputs | null; problem: string | null; waiting: string | null } => {
    const p = money(price, "price");
    const dp = money(down, "down payment");
    const t = money(tax, "property tax");
    const ins = money(insurance, "insurance");
    const typed = [p, dp, ...(kind === "mortgage" ? [t, ins] : [])].find((m) => m.problem);
    if (typed) return { loan: null, problem: typed.problem, waiting: null };
    const r = rate.trim() === "" ? null : Number(rate.replace(/[%\s]/g, ""));
    if (r !== null && !Number.isFinite(r)) return { loan: null, problem: "Type the rate as a percent, for example 6.5.", waiting: null };
    const y = years.trim() === "" ? null : Number(years);
    if (y !== null && !Number.isInteger(y)) return { loan: null, problem: "Type the years as a whole number.", waiting: null };
    if (p.cents === null || r === null || y === null) {
      const missing = [p.cents === null ? "price" : null, r === null ? "rate" : null, y === null ? "years" : null].filter(
        (x): x is string => x !== null
      );
      return { loan: null, problem: null, waiting: waitingFor(missing) };
    }
    const loan: LoanInputs = {
      priceCents: p.cents,
      downPaymentCents: dp.cents ?? 0,
      annualRate: r / 100,
      years: y,
      ...(kind === "mortgage" ? { propertyTaxYearCents: t.cents ?? 0, insuranceYearCents: ins.cents ?? 0 } : {}),
    };
    const problem = loanProblem(loan);
    return problem ? { loan: null, problem, waiting: null } : { loan, problem: null, waiting: null };
  }, [price, down, rate, years, tax, insurance, kind]);

  const loan = status.loan;
  const monthly = loan ? loanMonthlyCents(loan) : null;
  const monthlyLine =
    loan && monthly !== null
      ? kind === "mortgage"
        ? `Payment ${formatCents(loanMonthlyCents({ ...loan, propertyTaxYearCents: 0, insuranceYearCents: 0 }))} + tax ${formatCents(
            Math.round((loan.propertyTaxYearCents ?? 0) / 12)
          )} + insurance ${formatCents(Math.round((loan.insuranceYearCents ?? 0) / 12))} = ${formatCents(monthly)} a month`
        : `About ${formatCents(monthly)} a month`
      : null;

  const use = () => {
    if (!loan || monthly === null) return;
    onSave({
      kind,
      label: label.trim() || d.label,
      planningCategory: line.trim() || d.line,
      amountCents: monthly,
      // Stored, never read: the Forecast dates a loan from the
      // what-if's cost start, a car's payments for its years (datedChange).
      fromPeriod: editing?.fromPeriod ?? defaultFrom,
      untilPeriod: editing?.untilPeriod ?? null,
      loan,
    });
  };

  const field = (id: string, text: string, value: string, set: (v: string) => void, placeholder: string) => (
    <div className="grid gap-1">
      <Label htmlFor={id}>{text}</Label>
      <Input id={id} inputMode="decimal" className="font-mono" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.label}` : d.title}</DialogTitle>
          <DialogDescription>The payment a month is the standard fixed-rate loan payment.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="loan-label">Name of the change</Label>
              <Input id="loan-label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="loan-line">Budget line</Label>
              <Input id="loan-line" value={line} onChange={(e) => setLine(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("loan-price", "Price", price, setPrice, kind === "car" ? "35,000" : "800,000")}
            {field("loan-down", "Down payment", down, setDown, "0")}
            {field("loan-rate", "Rate (percent a year)", rate, setRate, "6.5")}
            {field("loan-years", "Years", years, setYears, kind === "car" ? "5" : "30")}
            {kind === "mortgage" && field("loan-tax", "Property tax a year", tax, setTax, "0")}
            {kind === "mortgage" && field("loan-insurance", "Insurance a year", insurance, setInsurance, "0")}
          </div>
          {monthlyLine && (
            <p data-testid="loan-monthly" className="font-mono">
              {monthlyLine}
            </p>
          )}
          {loan && loan.downPaymentCents > 0 && (
            <p data-testid="loan-down" className="text-muted-foreground">
              Down payment {formatCents(loan.downPaymentCents)}, paid once. It never counts toward a salary; the Forecast takes it in the month this what-if's costs begin.
            </p>
          )}
          {!status.problem && status.waiting && (
            <p data-testid="loan-waiting" className="text-muted-foreground">
              {status.waiting}
            </p>
          )}
          {status.problem && (
            <p role="alert" className="text-destructive">
              {status.problem}
            </p>
          )}
          {!status.problem && saveError && (
            <p role="alert" className="text-destructive">
              Not saved: {saveError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={use} disabled={!loan || busy}>
            Use this
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
