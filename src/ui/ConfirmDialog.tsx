// src/ui/ConfirmDialog.tsx -- one way to ask "are you sure?".
//
// The standing bar for this app is an explicit confirmation before anything is
// deleted or overwritten in bulk. Actions that acted at
// once now ask first: the Dashboard's Re-seed, deleting a Wish
// List item, deleting a categorization rule, Rebuild learned rules, and Model
// income's Apply (24 months of income written in one press). They all use this.
//
//   const confirm = useConfirm();
//   <Button onClick={() => confirm.ask({ title, description, confirmLabel, onConfirm })} />
//   {confirm.dialog}
//
// @shadcn/alert-dialog, already installed (BudgetGrid's seed confirmation and
// the Goals archive and delete confirmations use it directly).
import { useCallback, useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ConfirmRequest {
  title: string;
  /** What will happen, and whether it can be undone. Plain language. */
  description: string;
  /** The verb on the confirming button, e.g. "Delete deal". */
  confirmLabel: string;
  onConfirm: () => void;
}

export function useConfirm(): { ask: (request: ConfirmRequest) => void; dialog: ReactNode } {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const ask = useCallback((r: ConfirmRequest) => setRequest(r), []);

  const dialog = (
    <AlertDialog open={request !== null} onOpenChange={(open) => { if (!open) setRequest(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title ?? ""}</AlertDialogTitle>
          <AlertDialogDescription>{request?.description ?? ""}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const run = request?.onConfirm;
              setRequest(null);
              run?.();
            }}
          >
            {request?.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { ask, dialog };
}
