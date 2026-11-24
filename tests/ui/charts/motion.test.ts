import { expect, test } from "vitest";

import { switchMotion } from "../../../src/ui/charts/motion";

test("a view switch is 200 ms with a strong ease-out, and instant under reduced motion", () => {
  const m = switchMotion(false);
  expect(m.animation).toBe(true);
  expect(m.animationDurationUpdate).toBe(200);
  const ease = m.animationEasingUpdate as (t: number) => number;
  expect(ease(0)).toBeCloseTo(0, 5);
  expect(ease(1)).toBeCloseTo(1, 5);
  expect(ease(0.2)).toBeGreaterThan(0.5);
  // Entering bands move on the same 200 ms and curve, never the library's default.
  expect(m.animationDuration).toBe(200);
  expect(m.animationEasing).toBe(m.animationEasingUpdate);

  const r = switchMotion(true);
  expect(r.animation).toBe(false);
  expect(r.animationDurationUpdate).toBe(0);
});
