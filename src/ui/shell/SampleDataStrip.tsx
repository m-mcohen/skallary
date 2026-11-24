// src/ui/shell/SampleDataStrip.tsx
//
// One quiet line on every screen of the sample app (plan Project 1, task 6), so made-up
// figures are never mistaken for real ones. It cannot be closed.
//
// The thin centered bar of @shadcnblocks/banner1, held at the foot of the window, without its close button or link; theme tokens
// only, no motion. Not installed: the block is a dismissible announcement and this must stay.
export default function SampleDataStrip() {
  return (
    <p role="note" data-testid="sample-data-strip" className="w-full border-t border-border bg-muted px-4 py-1.5 text-center text-sm">
      <span className="font-medium">Sample data</span>{" "}
      <span className="text-muted-foreground">
        Every name and figure here is made up. Nothing here is linked to a bank.
      </span>
    </p>
  );
}
