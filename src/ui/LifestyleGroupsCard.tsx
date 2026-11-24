// src/ui/LifestyleGroupsCard.tsx -- Settings, Mappings: the groups the budget's spending lines
// are gathered under. Shows the household's saved list, or the starter groups until one is saved.
// Existing card, input and button components only; nothing here moves.
import { useEffect, useState } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { STARTER_LIFESTYLE_GROUPS, type LifestyleGroup } from "../domain/lifestyle-groups";
import { getLifestyleGroupsUI, setLifestyleGroupsUI } from "./lib/db-setup";

type Draft = { id: number; name: string; categories: string };

const toDraft = (groups: LifestyleGroup[]): Draft[] => groups.map((g) => ({ id: g.id, name: g.name, categories: g.categories.join(", ") }));

export default function LifestyleGroupsCard() {
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLifestyleGroupsUI().then(
      (saved) => { if (!cancelled) setDraft(toDraft(saved ?? STARTER_LIFESTYLE_GROUPS)); },
      () => { if (!cancelled) setError("Could not load the groups."); }
    );
    return () => { cancelled = true; };
  }, []);

  if (!draft) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null;

  const edit = (id: number, patch: Partial<Draft>) => setDraft((d) => d!.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const add = () => setDraft((d) => [...d!, { id: Math.max(0, ...d!.map((g) => g.id)) + 1, name: "", categories: "" }]);
  const save = async () => {
    setError(null);
    setMessage(null);
    const groups: LifestyleGroup[] = draft.map((g) => ({
      id: g.id,
      name: g.name.trim(),
      categories: g.categories.split(",").map((c) => c.trim()).filter(Boolean),
    }));
    if (groups.some((g) => g.name === "")) {
      setError("Each group needs a name.");
      return;
    }
    try {
      await setLifestyleGroupsUI(groups);
      setMessage("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the groups.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lifestyle groups</CardTitle>
        <CardDescription>
          The groups your spending lines are gathered under, in this order. List each group&rsquo;s
          categories separated by commas. A category in no group goes under Other.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {draft.map((g, i) => (
          <div key={g.id} className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-start">
            <Input className="sm:w-56" aria-label={`Group ${i + 1} name`} placeholder="Group name" value={g.name} onChange={(e) => edit(g.id, { name: e.target.value })} />
            <Input className="flex-1" aria-label={`Group ${i + 1} categories`} placeholder="Categories, separated by commas" value={g.categories} onChange={(e) => edit(g.id, { categories: e.target.value })} />
            <Button variant="outline" onClick={() => setDraft((d) => d!.filter((x) => x.id !== g.id))}>Remove</Button>
          </div>
        ))}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
        <div className="flex gap-2">
          <Button variant="outline" onClick={add}>Add a group</Button>
          <Button onClick={() => void save()}>Save</Button>
        </div>
      </CardContent>
    </Card>
  );
}
