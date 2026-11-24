// src/ui/GuideSettings.tsx -- Settings, Guide. One switch: whether "This page answers" shows on every
// screen. Backed by the shared store in
// src/ui/lib/guide-visibility.ts, the same store PageAnswers reads, so
// flipping it here is seen on every open screen at once.
//
// Registries checked: searched
// @shadcn-studio for "page header" and "toggle setting"; nothing beat the
// app's own installed @shadcn/switch + @shadcn/card, the same pair
// AccountsSection already uses for a single on/off preference
// (whether the partner's accounts count).
import { useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

import { setShowGuideLines, useShowGuideLines } from "./lib/guide-visibility";

export default function GuideSettings() {
  const show = useShowGuideLines();
  const [error, setError] = useState<string | null>(null);

  const handleChange = (checked: boolean) => {
    setError(null);
    setShowGuideLines(checked).catch(() => {
      setError("Could not save. Try again.");
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-base font-semibold">Guide</h2>
        <p className="text-sm text-muted-foreground">Should every page say what it answers?</p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Show the "This page answers" line</CardTitle>
              <CardDescription>
                Off hides the one-sentence line on every screen at once. The Help button and the
                Help section still explain each screen either way.
              </CardDescription>
            </div>
            <Switch checked={show} onCheckedChange={handleChange} aria-label='Show the "This page answers" line' />
          </div>
        </CardHeader>
        {error && (
          <CardContent>
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
