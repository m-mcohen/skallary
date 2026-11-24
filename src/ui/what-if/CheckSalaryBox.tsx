// src/ui/what-if/CheckSalaryBox.tsx
//
// Check a salary: type a yearly base salary and see which
// ladder steps it covers, walking the user's order and skipping what does not fit,
// then what is left each month. The arithmetic is checkSalary's. Its taxes are estimated (or, for
// exactly the current salary, the figures typed from a pay stub); until the tax step is set up,
// the set-this-up card stands in for the result.
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents, parseLooseDollarsToCents } from "../../domain/money";
import { hasFirmTaxes, type SalaryAssumptions } from "../../domain/salary";
import { checkSalary, type SalaryCheckContext, type WhatIfLadder } from "../../domain/what-if";
import { taxSetUpNeeded } from "../../domain/tax";
import { SetUpCard } from "../setup/SetUpCard";

export interface CheckSalaryBoxProps {
  ladder: WhatIfLadder;
  assumptions: SalaryAssumptions;
  /** The what-if's own salary, to start from; null leaves the box empty. */
  initialSalaryCents: number | null;
  /** The what-if and today's budget, so each step is priced afresh. */
  context?: SalaryCheckContext;
  /**
   * The user's current salary, when the what-if keeps it: checking exactly
   * that salary uses the user's firm tax figures from Settings; any other salary is estimated.
   */
  currentSalaryCents?: number | null;
}

const wholeDollarsText = (cents: number) => Math.round(cents / 100).toLocaleString("en-US");

export default function CheckSalaryBox({ ladder, assumptions, initialSalaryCents, context, currentSalaryCents = null }: CheckSalaryBoxProps) {
  const [text, setText] = useState(initialSalaryCents !== null ? wholeDollarsText(initialSalaryCents) : "");
  // Follow the what-if when ITS salary changes (another what-if is picked, or its salary is
  // edited), never on mount. The starting text is already right, and a mount effect runs a beat
  // after the box appears, so it overwrote a salary typed in that beat.
  const lastInitial = useRef(initialSalaryCents);
  useEffect(() => {
    if (lastInitial.current === initialSalaryCents) return;
    lastInitial.current = initialSalaryCents;
    setText(initialSalaryCents !== null ? wholeDollarsText(initialSalaryCents) : "");
  }, [initialSalaryCents]);

  // Loose on purpose: "150,000" and "$150,000" are read as typed.
  const gross = parseLooseDollarsToCents(text);
  const isCurrent = currentSalaryCents !== null && gross === currentSalaryCents;
  const firm = isCurrent && hasFirmTaxes(assumptions.firmTaxes);
  // Both tax figures typed for exactly the current salary need no estimate; anything else waits for the tax step.
  const allTyped = isCurrent && assumptions.firmTaxes?.federalAnnualCents != null && assumptions.firmTaxes?.payrollAnnualCents != null && assumptions.additionalSalary?.kind !== "w2";
  const waitsForTax = gross > 0 && !allTyped && taxSetUpNeeded(assumptions);
  const result = gross > 0 && !waitsForTax ? checkSalary(ladder, gross, assumptions, context ? { ...context, currentSalary: isCurrent } : undefined) : null;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="grid gap-1">
        <Label htmlFor="wi-check">Salary to check</Label>
        <Input id="wi-check" inputMode="decimal" className="w-40 font-mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="150,000" />
      </div>
      {waitsForTax && <SetUpCard step="tax" what="Checking a salary estimates its federal tax, which needs your filing status and children." />}
      {result && (
        <>
          <p className="text-muted-foreground">
            Leaves {formatCents(result.spendableMonthlyCents)} a month to spend, after tax, benefits and charity.{" "}
            <span data-testid="check-tax-source">{firm ? "Taxes: your firm figures from Settings, Salary." : "Taxes: estimated."}</span>
          </p>
          {!result.startCovered && <p className="text-destructive">This salary does not cover today's costs.</p>}
          {result.items.length > 0 && (
            <ul className="flex flex-col">
              {result.items.map((i) => (
                <li key={`${i.kind}-${i.id}`} data-testid="check-item" className={i.covered ? "" : "text-muted-foreground"}>
                  {i.label}: {i.covered ? "covered" : "not covered"}
                </li>
              ))}
            </ul>
          )}
          <p data-testid="check-left" className={`font-mono tabular-nums ${result.leftOverMonthlyCents < 0 ? "text-destructive" : ""}`}>
            Left over each month {formatCents(result.leftOverMonthlyCents)}
          </p>
        </>
      )}
    </div>
  );
}
