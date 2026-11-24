// src/ui/SalaryAssumptionsCard.tsx
// Settings > Salary: the tax profile behind "Salary needed": how the household files and the
// children claimed for the child tax credit. Both save together (PUT /api/settings/tax), as the
// first-run interview's tax step saves them. Until both are set, every estimated tax figure shows
// the set-this-up card instead.
// The premium is typed a paycheck with the tax figures, under Current salary, since all three
// come off the same paycheck. The charity pot's percent is on the Charity card. The native select
// matches the one in BenefitsEditor.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { loadDb, getSalarySettingsUI, type Db } from "./lib/db";
import { setTaxProfileUI } from "./lib/db-setup";
import type { SalaryAssumptions } from "../domain/salary";
import { FILING_STATUSES, FILING_STATUS_LABELS, isFilingStatus, type FilingStatus } from "../domain/tax";

export interface SalaryAssumptionsDataLayer {
  loadDb: () => Promise<Db>;
  getSalarySettings: (db: Db) => Promise<SalaryAssumptions>;
  /** Saves the filing status and the children together. */
  setTaxProfile: (p: { filingStatus: FilingStatus; children: number }) => Promise<void>;
}

const defaults: SalaryAssumptionsDataLayer = { loadDb, getSalarySettings: getSalarySettingsUI, setTaxProfile: setTaxProfileUI };

const LABEL = "flex flex-col gap-1 text-xs text-muted-foreground";

export default function SalaryAssumptionsCard({ dataLayer, onChanged }: { dataLayer?: Partial<SalaryAssumptionsDataLayer>; onChanged?: () => void }) {
  const deps = { ...defaults, ...dataLayer };
  const [filingStatus, setFilingStatus] = useState<FilingStatus | "">("");
  const [children, setChildren] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const a = await deps.getSalarySettings(await deps.loadDb());
        if (cancelled) return;
        setFilingStatus(a.tax?.filingStatus ?? "");
        // A count not set up shows blank, never a guessed number.
        const count = a.tax === undefined ? a.children : a.tax?.children ?? null;
        setChildren(count === null ? "" : String(count));
      } catch { /* the boxes stay blank */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!isFilingStatus(filingStatus)) {
      setStatus("Choose how you file.");
      return;
    }
    const childrenNum = Number(children);
    if (children.trim() === "" || !Number.isInteger(childrenNum)) {
      setStatus("Enter the number of children as a whole number.");
      return;
    }
    try { await deps.setTaxProfile({ filingStatus, children: childrenNum }); setStatus("Saved."); onChanged?.(); }
    catch (e) { setStatus(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax</CardTitle>
        <CardDescription>
          Behind "Salary needed" in the top bar and on the What if screen. Federal income tax is estimated from 2026 federal figures for your filing status.
          State and local taxes are not estimated; type them from a pay stub under Current salary. Benefits are typed under Current salary, one row per benefit.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <label className={LABEL}>Filing status
          <select
            aria-label="Filing status"
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
            value={filingStatus}
            onChange={(e) => setFilingStatus(isFilingStatus(e.target.value) ? e.target.value : "")}
          >
            <option value="">Choose</option>
            {FILING_STATUSES.map((s) => (
              <option key={s} value={s}>{FILING_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className={LABEL}>Number of children
          <Input aria-label="Number of children" inputMode="numeric" className="font-mono" value={children} onChange={(e) => setChildren(e.target.value)} />
        </label>
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button onClick={save}>Save</Button>
          <span role="status" className="text-xs text-muted-foreground">{status}</span>
        </div>
      </CardContent>
    </Card>
  );
}
