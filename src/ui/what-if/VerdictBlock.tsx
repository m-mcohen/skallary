// src/ui/what-if/VerdictBlock.tsx
//
// The verdict at the top of What if: does
// the salary cover everything switched on, and by how much a month. One sentence,
// worked out by salaryVerdict and worded by verdictText; red only when it falls
// short. It follows the switches as they change; no motion.
//
// Registry search (`npx shadcn@latest search @shadcn @shadcn-studio
// @shadcnblocks`, "alert" and "callout"): the generic alert variants and marketing
// callouts; none closer than the installed @shadcn/alert, which this uses.
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface VerdictBlockProps {
  /** The sentence, from verdictText. */
  text: string;
  /** True when the salary falls short: the one case shown in red. */
  short: boolean;
}

export default function VerdictBlock({ text, short }: VerdictBlockProps) {
  return (
    // A live status, not an alert: it changes with every switch, and should be read politely.
    <Alert data-testid="whatif-verdict" role="status" aria-live="polite" variant={short ? "destructive" : "default"} className={short ? "text-destructive" : undefined}>
      <AlertDescription className={`text-base font-medium ${short ? "text-destructive" : "text-foreground"}`}>{text}</AlertDescription>
    </Alert>
  );
}
