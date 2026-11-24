// src/ui/shell/BankProblemsDialog.tsx
//
// The box the Sync button opens when a bank needs the user: each bank in plain words with what to do, a link to
// the SimpleFIN Bridge in a new tab, and Close. The page's reload after a sync
// waits for Close, so the box is never reloaded away before the user reads it.
//
// @shadcn/alert-dialog, already installed. Theme tokens only, no motion
// beyond the component's own open and close.
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";

import { BRIDGE_URL, bankProblemShort, bankProblemStep, banksNeedYou, type BankProblem } from "../../domain/bank-problems";

export interface BankProblemsDialogProps {
  open: boolean;
  problems: BankProblem[];
  today: string;
  onClose: () => void;
}

export default function BankProblemsDialog({ open, problems, today, onClose }: BankProblemsDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-destructive">{banksNeedYou(problems.length)}</AlertDialogTitle>
          <AlertDialogDescription>
            The sync finished, and the other banks came in as usual.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-3 text-sm">
          {problems.map((p) => (
            <li key={`${p.kind}:${p.bank}`} className="flex flex-col gap-0.5">
              <span className="font-medium text-destructive">{bankProblemShort(p, today)}</span>
              <span className="text-muted-foreground">{bankProblemStep(p)}</span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <a href={BRIDGE_URL} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
            Open SimpleFIN Bridge
          </a>
          <Button onClick={onClose}>Close</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
