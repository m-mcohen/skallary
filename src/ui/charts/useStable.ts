import { useRef } from "react";

/** Returns the same object while its content is unchanged, so a screen that rebuilds chart inputs every render does not redraw (and reset the zoom of) its chart. */
export function useStable<T>(value: T): T {
  const kept = useRef<{ sig: string; value: T } | null>(null);
  const sig = JSON.stringify(value);
  if (kept.current === null || kept.current.sig !== sig) kept.current = { sig, value };
  return kept.current.value;
}
