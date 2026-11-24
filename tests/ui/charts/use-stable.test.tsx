// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, test } from "vitest";

import { useStable } from "../../../src/ui/charts/useStable";

test("chart inputs rebuilt with the same figures are the same object, so the chart is not redrawn", () => {
  const { result, rerender } = renderHook(({ v }) => useStable(v), { initialProps: { v: [{ id: "a", cents: [1, 2] }] } });
  const first = result.current;
  rerender({ v: [{ id: "a", cents: [1, 2] }] });
  expect(result.current).toBe(first);
  rerender({ v: [{ id: "a", cents: [1, 3] }] });
  expect(result.current).not.toBe(first);
});
