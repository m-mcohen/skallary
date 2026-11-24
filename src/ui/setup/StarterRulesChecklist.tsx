// src/ui/setup/StarterRulesChecklist.tsx -- choice c of the filing step: the
// standard categories plus only the starter rules the person ticks. Each row is a national
// merchant and the category its purchases go under. Nothing is written until the button is pressed.
// The app's own card, checkbox and button components only.
import { useMemo, useState, type JSX } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STARTER_RULES } from "../../domain/starter-set";
import { applyStarterFilingUI } from "../lib/db-setup";

type Result = { categoriesAdded: number; rulesAdded: number };

/** One row per merchant: a merchant with two spellings on statements has two rules under one name. */
interface Row { name: string; category: string; ids: string[] }

function merchantRows(): Row[] {
  const rows = new Map<string, Row>();
  for (const r of STARTER_RULES) {
    const row = rows.get(r.name) ?? { name: r.name, category: r.planningCategory, ids: [] };
    row.ids.push(r.id);
    rows.set(r.name, row);
  }
  return [...rows.values()];
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function StarterRulesChecklist({ onApplied }: { onApplied?: (r: Result) => void }): JSX.Element {
  const rows = useMemo(merchantRows, []);
  const byCategory = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const row of rows) groups.set(row.category, [...(groups.get(row.category) ?? []), row]);
    return [...groups.entries()];
  }, [rows]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (name: string, on: boolean) =>
    setTicked((t) => { const next = new Set(t); if (on) next.add(name); else next.delete(name); return next; });

  const apply = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const ids = rows.filter((r) => ticked.has(r.name)).flatMap((r) => r.ids);
      // Nothing ticked is choice b: the categories only.
      const result = ids.length === 0 ? await applyStarterFilingUI("categories-only") : await applyStarterFilingUI("checklist", ids);
      setMessage(`Added ${count(result.categoriesAdded, "category", "categories")} and ${count(result.rulesAdded, "rule", "rules")}.`);
      onApplied?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start filing.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pick the stores you use</CardTitle>
        <CardDescription>
          Tick a store and its purchases are filed for you under the category shown. The standard
          categories are added either way. You can change any of this later.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setTicked(new Set(rows.map((r) => r.name)))}>Tick all</Button>
          <Button size="sm" variant="outline" onClick={() => setTicked(new Set())}>Clear</Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {byCategory.map(([category, merchants]) => (
            <fieldset key={category} className="flex flex-col gap-1.5 rounded-lg border bg-background p-3">
              <legend className="px-1 text-sm font-medium">{category}</legend>
              {merchants.map((m) => (
                <label key={m.name} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={ticked.has(m.name)} onCheckedChange={(c: boolean) => toggle(m.name, c)} />
                  {m.name}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
        <div>
          <Button disabled={busy} onClick={() => void apply()}>
            {ticked.size === 0 ? "Add the categories only" : `File ${count(ticked.size, "store", "stores")} this way`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
