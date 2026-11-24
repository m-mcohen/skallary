// src/ui/AppearanceSettings.tsx -- Settings, Appearance (C6, 2026-11-21): Light, Dark, or follow the computer.
//
// Registries checked (2026-11-21): searched @shadcn and @shadcn-studio for "toggle group" and "theme";
// the app already ships @shadcn toggle-group and card, so this uses those.
import { useState, useSyncExternalStore } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type { ThemePreference } from "./lib/db";
import { chooseTheme, getThemePreference, subscribeTheme } from "./lib/theme";

const CHOICES: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match my computer" },
];

export default function AppearanceSettings() {
  const pref = useSyncExternalStore(subscribeTheme, getThemePreference);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-base font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">Light or dark colors for every screen.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Colors</CardTitle>
          <CardDescription>Match my computer follows your computer's light or dark setting as it changes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <ToggleGroup
            variant="outline"
            value={[pref]}
            onValueChange={(v: string[]) => {
              const next = v[0] as ThemePreference | undefined;
              if (!next || next === pref) return;
              setError(null);
              chooseTheme(next).catch(() => setError("Could not save. Try again."));
            }}
            aria-label="Colors"
          >
            {CHOICES.map((c) => (
              <ToggleGroupItem key={c.value} value={c.value}>
                {c.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
