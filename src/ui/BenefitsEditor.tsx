// src/ui/BenefitsEditor.tsx
//
// Settings > Salary, Benefits: one row per benefit
// the user pays for out of the user's paycheck, typed from the pay stub or the enrollment papers: a name,
// an amount, a paycheck or a month, and Before tax, ticked unless the user unticks it. Under the
// rows: what they come to a month and a year, and how much of it is before tax. It replaces
// the single "Health premium, a paycheck" box.
//
// Business UI wired to the user's own figures, so no registry search; it is built from
// the installed Input, Checkbox and Button, with a native select for a paycheck or a month,
// like the what-if picker. Controlled: CurrentSalaryCard holds the rows and saves them with
// Save salary. No motion.
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { benefitMonthlyCents, type BenefitEvery } from "../domain/benefits";
import type { PaySchedule } from "../domain/paycheck";
import { formatCents, parseDollarsToCents } from "../domain/money";

/** One row as typed: the amount stays text until Save salary reads it. */
export interface BenefitDraft {
  /** A key for the row on this screen only; never saved. */
  key: number;
  name: string;
  amount: string;
  every: BenefitEvery;
  beforeTax: boolean;
}

/** A row's amount a month, read loosely while typing; null when it does not read as dollars yet. */
function draftMonthlyCents(d: BenefitDraft, schedule: PaySchedule | null): number | null {
  let cents: number;
  try {
    cents = parseDollarsToCents(d.amount);
  } catch {
    return null;
  }
  if (cents < 0) return null;
  return benefitMonthlyCents({ name: d.name, amountCents: cents, every: d.every, beforeTax: d.beforeTax }, schedule);
}

/** What the rows come to a month, and the part before tax, read loosely while typing. */
export function draftTotals(rows: BenefitDraft[], schedule: PaySchedule | null): { monthlyCents: number; beforeTaxMonthlyCents: number } {
  let monthlyCents = 0;
  let beforeTaxMonthlyCents = 0;
  for (const d of rows) {
    const m = draftMonthlyCents(d, schedule) ?? 0;
    monthlyCents += m;
    if (d.beforeTax) beforeTaxMonthlyCents += m;
  }
  return { monthlyCents, beforeTaxMonthlyCents };
}

const LABEL = "flex flex-col gap-1 text-xs text-muted-foreground";

export default function BenefitsEditor({
  rows,
  onChange,
  schedule,
  estimateMonthlyCents,
}: {
  rows: BenefitDraft[];
  onChange: (rows: BenefitDraft[]) => void;
  schedule: PaySchedule | null;
  /** What the app assumes a month when nothing is typed. */
  estimateMonthlyCents: number;
}) {
  const nextKey = rows.reduce((k, r) => Math.max(k, r.key), 0) + 1;
  const set = (key: number, patch: Partial<BenefitDraft>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const totals = draftTotals(rows, schedule);

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <p className="text-sm font-medium">Benefits</p>
      <p className="text-xs text-muted-foreground">
        Each benefit you pay for out of your paycheck, such as health insurance, dental and vision, disability, or an HSA or FSA contribution. Type it a
        paycheck or a month. Before tax lowers the wages that are taxed; untick it for a benefit taken after tax. Every salary the app works out uses these.
      </p>
      {rows.length === 0 ? (
        <p data-testid="benefits-none" className="text-xs text-muted-foreground">
          {estimateMonthlyCents > 0 ? `None typed: the app estimates ${formatCents(estimateMonthlyCents)} a month.` : "None typed: no benefits come out of pay."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r, i) => {
            const n = i + 1;
            const monthly = draftMonthlyCents(r, schedule);
            return (
              <li key={r.key} data-testid="benefit-row" className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto_auto_auto] sm:items-end">
                <label className={LABEL}>
                  Benefit
                  <Input aria-label={`Benefit ${n} name`} value={r.name} placeholder="Health insurance" onChange={(e) => set(r.key, { name: e.target.value })} />
                </label>
                <label className={LABEL}>
                  Amount
                  <Input aria-label={`Benefit ${n} amount`} inputMode="decimal" className="font-mono" value={r.amount} placeholder="0.00" onChange={(e) => set(r.key, { amount: e.target.value })} />
                </label>
                <label className={LABEL}>
                  Every
                  <select
                    aria-label={`Benefit ${n} every`}
                    className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
                    value={r.every}
                    onChange={(e) => set(r.key, { every: e.target.value as BenefitEvery })}
                  >
                    <option value="paycheck">A paycheck</option>
                    <option value="month">A month</option>
                  </select>
                </label>
                <label className="flex h-8 items-center gap-2 text-sm">
                  <Checkbox aria-label={`Benefit ${n} before tax`} checked={r.beforeTax} onCheckedChange={(c: boolean) => set(r.key, { beforeTax: c })} />
                  Before tax
                </label>
                <Button variant="ghost" size="sm" aria-label={`Remove benefit ${n}`} onClick={() => onChange(rows.filter((x) => x.key !== r.key))}>
                  Remove
                </Button>
                {r.every === "paycheck" && (
                  <span data-testid={`benefit-hint-${n}`} className="text-xs text-muted-foreground sm:col-span-5">
                    {!schedule ? "Pick how often you are paid above first." : monthly === null ? "Type dollars, such as 500.00." : `Comes to ${formatCents(monthly)} a month.`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => onChange([...rows, { key: nextKey, name: "", amount: "", every: "month", beforeTax: true }])}>
          Add a benefit
        </Button>
        {rows.length > 0 && (
          <span data-testid="benefits-total" className="text-xs text-muted-foreground">
            In all <span className="font-mono tabular-nums">{formatCents(totals.monthlyCents)} a month</span> (
            <span className="font-mono tabular-nums">{formatCents(totals.monthlyCents * 12)} a year</span>),{" "}
            <span className="font-mono tabular-nums">{formatCents(totals.beforeTaxMonthlyCents)}</span> of it before tax.
          </span>
        )}
      </div>
    </div>
  );
}
