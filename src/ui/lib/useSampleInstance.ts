// src/ui/lib/useSampleInstance.ts
//
// Whether this copy of the app runs on sample data (GET /api/instance). Asked once per page
// and shared: the answer cannot change while the server runs. Anything unreadable reads as
// "not the sample", so a real app never loses a control because of a failed read; the server
// refuses bank routes on sample data by itself.
import { useEffect, useState } from "react";

import { getInstanceUI } from "./db";

/** What the Sync button and Bank connection say on sample data. */
export const SAMPLE_NO_BANK_SHORT = "This is sample data. It cannot be linked to a bank.";

let asked: Promise<boolean> | null = null;

function askOnce(): Promise<boolean> {
  return (asked ??= getInstanceUI().then((r) => r?.sample === true, () => false));
}

export function useSampleInstance(): boolean {
  const [sample, setSample] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void askOnce().then((s) => {
      if (!cancelled) setSample(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return sample;
}
