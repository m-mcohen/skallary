// @vitest-environment jsdom
// tests/ui/useBudgetData.test.tsx -- the Budget screens' reads across a year line (stepping from January back to December briefly showed December against
// January's budget while the earlier year's budget was still being read).
import { expect, test } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useBudgetData } from "../../src/ui/budget/useBudgetData";
import type { BudgetLine, Plan } from "../../src/domain/plan-types";
import { makeBudgetLayer, PLAN } from "./budget-fixtures";

const PLAN_2027: Plan = { id: "plan-2027", name: "2027", startDate: "2027-01-01", endDate: "2027-12-31", createdAt: "" };

test("a month in another year's budget never shows with the old year's budget while it loads", async () => {
  const { layer } = makeBudgetLayer();
  layer.listPlans = async () => [PLAN, PLAN_2027];
  const own = layer.getBudgetLines;
  // The earlier year's lines never arrive, so the hook stays between the two years.
  layer.getBudgetLines = (db, planId) => (planId === PLAN.id ? new Promise<BudgetLine[]>(() => {}) : own(db, planId));
  const { result, rerender } = renderHook(({ month }) => useBudgetData(null, layer, month), { initialProps: { month: "2027-01" } });
  await waitFor(() => expect(result.current.data?.plan.id).toBe(PLAN_2027.id));
  rerender({ month: "2026-12" });
  expect(result.current.data).toBeNull();
  expect(result.current.phase).toBe("loading");
});

test("a month in the same year's budget keeps the data on screen while it reads", async () => {
  const { layer } = makeBudgetLayer();
  const { result, rerender } = renderHook(({ month }) => useBudgetData(null, layer, month), { initialProps: { month: "2026-10" } });
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  rerender({ month: "2026-09" });
  expect(result.current.data?.plan.id).toBe(PLAN.id);
  expect(result.current.phase).toBe("ready");
});
