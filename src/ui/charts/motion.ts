// Chart motion. No chart draws itself in; the only movement is a view switch (the Sankey's), which
// bridges the change in 200 ms on the project's strong ease-out and is instant under reduced motion.

export const SWITCH_MS = 200;

/** A CSS cubic-bezier(x1, y1, x2, y2) as a function of progress, for ECharts' easing option. */
export function bezierEase(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const fy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = fx(t) - x;
      if (Math.abs(e) < 1e-5) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return fy(t);
  };
}

/** The project's --ease-ui-out, cubic-bezier(0.23, 1, 0.32, 1). */
export const EASE_UI_OUT = bezierEase(0.23, 1, 0.32, 1);

type Easing = ((t: number) => number) | "linear";

/** Both the entering and the updating parts of a switch take the same 200 ms and curve, so no part
 *  falls back to the library's default motion; under reduced motion everything is instant. */
export function switchMotion(reduced: boolean): {
  animation: boolean;
  animationDuration: number;
  animationEasing: Easing;
  animationDurationUpdate: number;
  animationEasingUpdate: Easing;
} {
  if (reduced) {
    return { animation: false, animationDuration: 0, animationEasing: "linear", animationDurationUpdate: 0, animationEasingUpdate: "linear" };
  }
  return {
    animation: true,
    animationDuration: SWITCH_MS, animationEasing: EASE_UI_OUT,
    animationDurationUpdate: SWITCH_MS, animationEasingUpdate: EASE_UI_OUT,
  };
}

/** Read at the moment of a switch, so a change to the setting applies to the next switch. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
