// src/ui/budget/ChangeBar.tsx -- the change bar at the end of a row: centered; less than the comparison grows left, more grows right. Every
// bar on screen shares one scale, so their lengths compare. App-specific (no registry item).
import { changeBarGeometry, type Tone } from "../../domain/budget-colors";
import { cn } from "@/lib/utils";

const toneBg: Record<Tone, string> = { red: "bg-budget-red", blue: "bg-budget-blue", grey: "bg-budget-grey" };

export default function ChangeBar({ changeCents, scaleCents, tone, label }: { changeCents: number | null; scaleCents: number; tone: Tone; label: string }) {
  const g = changeBarGeometry(changeCents, scaleCents);
  return (
    <div role="img" aria-label={label} className="relative h-2 w-full min-w-16">
      <div className="absolute -inset-y-1 left-1/2 w-px bg-border" />
      {g && (
        <div
          data-part="change"
          className={cn("absolute inset-y-0 rounded-full", toneBg[tone])}
          style={g.side === "left" ? { right: "50%", width: `${g.pct}%` } : { left: "50%", width: `${g.pct}%` }}
        />
      )}
    </div>
  );
}
