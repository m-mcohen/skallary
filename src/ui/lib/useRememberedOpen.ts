// src/ui/lib/useRememberedOpen.ts
//
// An open or shut choice remembered on this computer, the way the ladder
// remembers Monthly | Yearly. `fallback` stands until a choice is made. Storage can be
// blocked (a private window, cleared site data): reads and writes may throw, and then the
// choice lasts until the page reloads.
import { useState } from "react";

export function useRememberedOpen(key: string, fallback: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : v === "true";
    } catch {
      return fallback;
    }
  });
  const choose = (next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(key, String(next));
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
  };
  return [open, choose];
}
