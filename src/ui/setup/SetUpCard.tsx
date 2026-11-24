// src/ui/setup/SetUpCard.tsx -- the "set this up" card. A screen whose figure depends on a
// skipped or unanswered interview step shows this card in its place, never a guessed figure.
// Built from the app's own Card and button styles.
import type { JSX } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import type { SetupStepId } from "../../domain/setup-progress";

export function SetUpCard({ step, what }: { step: SetupStepId; what: string }): JSX.Element {
  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-muted-foreground">{what}</p>
        <a className={buttonVariants({ size: "sm", variant: "outline" })} href={`#/setup/${step}`}>
          Set this up
        </a>
      </CardContent>
    </Card>
  );
}
