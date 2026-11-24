// src/ui/goals/GoalPaymentHelper.tsx -- "Work out the payment". Fills the goal's ongoing-cost box
// once and never recalculates it later. The loan math is the What if screen's
// (loanMonthlyCents), plus HOA, which only this helper asks for.
//
// App-specific business UI wired to the user's data, so no registry search: it is
// built from the app's own Input, Label and Button, like the What if loan form.
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { formatWholeDollars, parseDollarsToCents } from "../../domain/money";
import { formatDateRange } from "../../domain/period";
import { loanMonthlyCents, loanProblem } from "../../domain/what-if";
import type { MortgageRates } from "../lib/db";

/** Dollars typed in a box, as cents; blank is 0; unreadable is NaN (reported, never guessed). */
function dollars(text: string): number {
  if (!text.trim()) return 0;
  try {
    return parseDollarsToCents(text);
  } catch {
    return Number.NaN;
  }
}

export interface GoalPaymentHelperProps {
  /** The goal's savings target, offered as the down payment with one click. */
  targetCents: number;
  /** Today's Freddie Mac averages, or null when they cannot be had. Asked once, when the helper opens. */
  getRates: () => Promise<MortgageRates | null>;
  /** Called with the monthly total when the user presses Use this. */
  onUse: (monthlyCents: number) => void;
}

export default function GoalPaymentHelper({ targetCents, getRates, onUse }: GoalPaymentHelperProps) {
  const [price, setPrice] = useState("");
  const [down, setDown] = useState("");
  const [years, setYears] = useState("30");
  const [rate, setRate] = useState("");
  const [rateTyped, setRateTyped] = useState(false);
  const [tax, setTax] = useState("");
  const [insurance, setInsurance] = useState("");
  const [hoa, setHoa] = useState("");
  // undefined while asking; null when there is no rate to be had.
  const [rates, setRates] = useState<MortgageRates | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void getRates()
      .catch(() => null)
      .then((r) => {
        if (!cancelled) setRates(r);
      });
    return () => {
      cancelled = true;
    };
    // Asked once when the helper opens; the survey changes weekly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Freddie Mac publishes 30-year and 15-year averages only (choice 4A).
  const survey = rates ? (years.trim() === "15" ? rates.fifteenYear : years.trim() === "30" ? rates.thirtyYear : null) : null;
  // Prefilled until the user types a rate of the user's own; always editable.
  useEffect(() => {
    if (!rateTyped) setRate(survey ? String(survey.ratePct) : "");
  }, [survey, rateTyped]);

  const loan = {
    priceCents: dollars(price),
    downPaymentCents: dollars(down),
    annualRate: Number(rate) / 100,
    years: Number(years),
    propertyTaxYearCents: dollars(tax),
    insuranceYearCents: dollars(insurance),
  };
  const hoaCents = dollars(hoa);
  const waiting = !price.trim() || !rate.trim();
  const unreadable = [loan.priceCents, loan.downPaymentCents, loan.propertyTaxYearCents, loan.insuranceYearCents, hoaCents].some(Number.isNaN);
  const problem = waiting
    ? null
    : unreadable
      ? "One of the amounts is not a dollar figure."
      : loanProblem(loan) ?? (hoaCents < 0 ? "HOA cannot be below zero." : null);
  const ready = !waiting && !problem;
  const payment = ready ? loanMonthlyCents({ ...loan, propertyTaxYearCents: 0, insuranceYearCents: 0 }) : 0;
  const taxMonthly = ready ? Math.round(loan.propertyTaxYearCents / 12) : 0;
  const insuranceMonthly = ready ? Math.round(loan.insuranceYearCents / 12) : 0;
  const total = payment + taxMonthly + insuranceMonthly + (ready ? hoaCents : 0);

  const box = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );

  return (
    <div data-testid="payment-helper" className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {box("helper-price", "Price", price, setPrice)}
        <div className="flex flex-col gap-1">
          <Label htmlFor="helper-down">Down payment</Label>
          <Input id="helper-down" inputMode="decimal" value={down} onChange={(e) => setDown(e.target.value)} />
          {targetCents > 0 && (
            <span className="text-xs text-muted-foreground">
              Goal target: {formatWholeDollars(targetCents)}{" "}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                aria-label="Use the goal target as the down payment"
                onClick={() => setDown((targetCents / 100).toFixed(2))}
              >
                Use
              </Button>
            </span>
          )}
        </div>
        {box("helper-years", "Years", years, setYears)}
        <div className="flex flex-col gap-1">
          <Label htmlFor="helper-rate">Rate (%)</Label>
          <Input
            id="helper-rate"
            inputMode="decimal"
            value={rate}
            onChange={(e) => {
              setRateTyped(true);
              setRate(e.target.value);
            }}
          />
          {survey && !rateTyped && (
            <span className="text-xs text-muted-foreground">
              Freddie Mac weekly average, week of {formatDateRange(survey.weekOf, survey.weekOf)}: {survey.ratePct}%
            </span>
          )}
          {rates === null && <span className="text-xs text-muted-foreground">Could not get today's rate; type one.</span>}
        </div>
        {box("helper-tax", "Property tax a year", tax, setTax)}
        {box("helper-insurance", "Insurance a year", insurance, setInsurance)}
        {box("helper-hoa", "HOA a month", hoa, setHoa)}
      </div>
      {problem && <p className="text-sm text-destructive">{problem}</p>}
      {waiting && <p className="text-sm text-muted-foreground">Type the price and the rate to see the payment.</p>}
      {ready && (
        <p data-testid="helper-total" className="font-mono text-sm tabular-nums">
          Payment {formatWholeDollars(payment)} + tax {formatWholeDollars(taxMonthly)} + insurance {formatWholeDollars(insuranceMonthly)} + HOA {formatWholeDollars(hoaCents)} = {formatWholeDollars(total)} a month
        </p>
      )}
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={!ready} onClick={() => onUse(total)}>
          Use this
        </Button>
      </div>
    </div>
  );
}
