// @vitest-environment jsdom
// tests/ui/usePlanState.test.tsx
//
// usePlanState keeps the raw scenario-row list from the API as
// `savedScenarios` (empty when the plan has none saved). The built-in A/B/C
// scenarios and their fallback left with the Scenarios screen ; `savedScenarios` is exactly what the API returned, nothing
// more. AppShell can't be driven far enough under jsdom (the local server is
// unreachable, so planId never resolves) to reach the What if screen's
// picker, so this tests the hook directly with the data layer mocked.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const listPlansUI = vi.fn(async () => [{ id: "p1", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" }]);
const getPlanUI = vi.fn(async () => ({ id: "p1", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" }));
const listScenariosUI = vi.fn(async () => []);
const listWhatIfsUI = vi.fn(async () => []);
const loadDb = vi.fn(async () => ({}) as never);
// A stand-in for one of useMastheadInputs's reads: its
// call count is how the "refreshWhatIfs never re-reads the budget/
// transactions" test proves what it proves.
const getBudgetLinesUI = vi.fn(async () => []);
const listGoalsUI = vi.fn(async () => []);

vi.mock("../../src/ui/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/ui/lib/db")>();
  return {
    ...actual,
    loadDb: (...args: unknown[]) => loadDb(...args),
    listPlansUI: (...args: unknown[]) => listPlansUI(...(args as [never])),
    getPlanUI: (...args: unknown[]) => getPlanUI(...(args as [never, never])),
    listScenariosUI: (...args: unknown[]) => listScenariosUI(...(args as [never, never])),
    listWhatIfsUI: (...args: unknown[]) => listWhatIfsUI(...(args as [never, never])),
    getBudgetLinesUI: (...args: unknown[]) => getBudgetLinesUI(...(args as [never, never])),
    listGoalsUI: (...args: unknown[]) => listGoalsUI(...(args as [never])),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  listPlansUI.mockResolvedValue([{ id: "p1", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" }] as never);
  getPlanUI.mockResolvedValue({ id: "p1", name: "Plan", startDate: "2026-01-01", endDate: "2026-12-31" } as never);
  listScenariosUI.mockResolvedValue([] as never);
  listWhatIfsUI.mockResolvedValue([] as never);
  getBudgetLinesUI.mockResolvedValue([] as never);
  listGoalsUI.mockResolvedValue([] as never);
});

// A what-if save used to re-read every transaction along
// with the what-ifs, because both flowed through the same `refresh()`/`tick`.
describe("refreshWhatIfs", () => {
  test("re-reads only the what-ifs, not the budget/transactions read behind the top bar", async () => {
    const { usePlanState } = await import("../../src/ui/lib/usePlanState");
    const { result } = renderHook(() => usePlanState());
    await waitFor(() => expect(result.current.planId).toBe("p1"));
    await waitFor(() => expect(listWhatIfsUI).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getBudgetLinesUI).toHaveBeenCalledTimes(1));

    act(() => result.current.refreshWhatIfs());
    await waitFor(() => expect(listWhatIfsUI).toHaveBeenCalledTimes(2));
    expect(getBudgetLinesUI).toHaveBeenCalledTimes(1); // unchanged

    // A full refresh still re-reads both, proving this is a narrower sibling
    // of refresh(), not a replacement for it.
    act(() => result.current.refresh());
    await waitFor(() => expect(getBudgetLinesUI).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listWhatIfsUI).toHaveBeenCalledTimes(3));
  });

  // The scenario rows follow the lighter refresh too, so a
  // what-if saved alongside a new row reaches the top-bar menu without a full refresh.
  test("a what-if that appears between refreshes reaches the menu on the lighter refresh", async () => {
    const row = (id: string, name: string) => ({ id, planId: "p1", name, isDefault: false, income: { kind: "plan" as const }, expenseDeltas: [], createdAt: "" });
    const blank = (id: string) => ({ scenarioId: id, salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] });
    listScenariosUI.mockResolvedValue([row("w1", "First")] as never);
    listWhatIfsUI.mockResolvedValue([blank("w1")] as never);
    const { usePlanState } = await import("../../src/ui/lib/usePlanState");
    const { result } = renderHook(() => usePlanState());
    await waitFor(() => expect(result.current.whatIfScenarios.map((s) => s.name)).toEqual(["First"]));
    listScenariosUI.mockResolvedValue([row("w1", "First"), row("w2", "Second")] as never);
    listWhatIfsUI.mockResolvedValue([blank("w1"), blank("w2")] as never);
    act(() => result.current.refreshWhatIfs());
    await waitFor(() => expect(result.current.whatIfScenarios.map((s) => s.name).sort()).toEqual(["First", "Second"]));
  });
});

describe("the what-if overlay", () => {
  const older = { id: "old", planId: "p1", name: "Offer B", isDefault: true, income: { kind: "plan" as const }, expenseDeltas: [], createdAt: "" };
  const offerA = { id: "w1", planId: "p1", name: "Offer A", isDefault: false, income: { kind: "plan" as const }, expenseDeltas: [], createdAt: "" };
  const whatIf = {
    scenarioId: "w1", salaryGrossAnnualCents: 12_000_000, salaryFromPeriod: "2026-11", rows: [],
    changes: [{ id: "car", position: 1, kind: "add", label: "Car", planningCategory: "Car payment", amountCents: 60_000, fromPeriod: "2027-03", untilPeriod: null, loan: null }],
  };

  test("the app opens on Real numbers, even when an older scenario is marked default", async () => {
    listScenariosUI.mockResolvedValue([older, offerA] as never);
    listWhatIfsUI.mockResolvedValue([whatIf] as never);
    const { usePlanState } = await import("../../src/ui/lib/usePlanState");
    const { result } = renderHook(() => usePlanState());
    await waitFor(() => expect(result.current.whatIfScenarios.length).toBe(1));
    expect(result.current.scenarioId).toBeNull();
    expect(result.current.scenario).toBeNull();
    expect(result.current.activeWhatIf).toBeNull();
  });

  test("the menu's list is the what-ifs only, each composed so every screen sees its changes", async () => {
    listScenariosUI.mockResolvedValue([older, offerA] as never);
    listWhatIfsUI.mockResolvedValue([whatIf] as never);
    const { usePlanState } = await import("../../src/ui/lib/usePlanState");
    const { result } = renderHook(() => usePlanState());
    await waitFor(() => expect(result.current.whatIfScenarios.map((s) => s.name)).toEqual(["Offer A"]));
    const composed = result.current.whatIfScenarios[0];
    expect(composed.income).toMatchObject({ kind: "custom", startPeriod: "2026-11" });
    expect(composed.expenseDeltas.some((d) => d.planningCategory === "Car payment" && d.period === "2027-03")).toBe(true);
  });

  test("picking a what-if turns on its composed scenario; an older scenario's id turns nothing on", async () => {
    listScenariosUI.mockResolvedValue([older, offerA] as never);
    listWhatIfsUI.mockResolvedValue([whatIf] as never);
    const { usePlanState } = await import("../../src/ui/lib/usePlanState");
    const { result } = renderHook(() => usePlanState());
    await waitFor(() => expect(result.current.whatIfScenarios.length).toBe(1));
    act(() => result.current.setScenarioId("w1"));
    expect(result.current.scenario?.expenseDeltas.some((d) => d.planningCategory === "Car payment")).toBe(true);
    expect(result.current.activeWhatIf?.scenarioId).toBe("w1");
    act(() => result.current.setScenarioId("old"));
    expect(result.current.scenario).toBeNull();
  });

  test("with no what-ifs saved, the menu offers nothing but Real numbers", async () => {
    const { usePlanState } = await import("../../src/ui/lib/usePlanState");
    const { result } = renderHook(() => usePlanState());
    await waitFor(() => expect(result.current.planId).toBe("p1"));
    await waitFor(() => expect(listWhatIfsUI).toHaveBeenCalled());
    expect(result.current.whatIfScenarios).toEqual([]);
  });
});

test("with no saved scenarios, savedScenarios is empty -- no built-in fallback", async () => {
  const { usePlanState } = await import("../../src/ui/lib/usePlanState");
  const { result } = renderHook(() => usePlanState());
  await waitFor(() => expect(result.current.planId).toBe("p1"));
  await waitFor(() => expect(listScenariosUI).toHaveBeenCalled());
  expect(result.current.savedScenarios).toEqual([]);
});

test("with saved scenarios, savedScenarios carries exactly the raw API list", async () => {
  const saved = [{ id: "s1", planId: "p1", name: "My view", isDefault: false, income: { kind: "plan" as const }, expenseDeltas: [], createdAt: "" }];
  listScenariosUI.mockResolvedValue(saved as never);
  const { usePlanState } = await import("../../src/ui/lib/usePlanState");
  const { result } = renderHook(() => usePlanState());
  await waitFor(() => expect(result.current.savedScenarios).toEqual(saved));
});

test("the budget is named by its year, not by its stored name or id", async () => {
  getPlanUI.mockResolvedValue({ id: "plan-2026", name: "2026 Plan", startDate: "2026-01-01", endDate: "2026-12-31" } as never);
  const { usePlanState } = await import("../../src/ui/lib/usePlanState");
  const { result } = renderHook(() => usePlanState());
  await waitFor(() => expect(result.current.planName).toBe("Budget: 2026"));
});

// The top-bar overlay counts a ticked goal's planned cost too.
describe("the what-if overlay and goals", () => {
  test("a switched-on goal cost row reaches the composed what-if from next month", async () => {
    const row = { id: "w1", planId: "p1", name: "What if I had a house", isDefault: false, income: { kind: "plan" as const }, expenseDeltas: [], createdAt: "" };
    listScenariosUI.mockResolvedValue([row] as never);
    listWhatIfsUI.mockResolvedValue([{ scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [{ kind: "goal-cost", refId: "House", position: 1, on: true }, { kind: "goal-saving", refId: "House", position: 2, on: true }] }] as never);
    listGoalsUI.mockResolvedValue([{ id: "House", name: "House", goalType: "savings", targetAmountCents: 100, targetDate: null, priority: 0, currentAmountCents: 0, plannedMonthlyCents: 0, notes: "", archivedAt: null, ongoingMonthlyCents: 250_000, ongoingStartedPeriod: null }] as never);
    const { usePlanState } = await import("../../src/ui/lib/usePlanState");
    const { addMonths } = await import("../../src/domain/scenario");
    const { localDateIso } = await import("../../src/domain/period");
    const { result } = renderHook(() => usePlanState());
    const next = addMonths(localDateIso().slice(0, 7), 1);
    await waitFor(() => {
      const s = result.current.whatIfScenarios.find((x) => x.id === "w1");
      expect(s?.expenseDeltas).toContainEqual({ planningCategory: "Goal cost 1", period: next, deltaCents: 250_000 });
    });
  });
});

// When goals cannot be read, a what-if with ticked goals
// says its figures leave their costs out, instead of quietly showing smaller numbers.
describe("goal costs missing", () => {
  const houseWhatIf = { id: "w1", planId: "p1", name: "House what-if", isDefault: false, income: { kind: "plan" as const }, expenseDeltas: [], createdAt: "" };
  const ticked = { scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [{ kind: "goal-saving", refId: "house", position: 1, on: true }] };
  const unticked = { ...ticked, rows: [] };

  const open = async () => {
    const { usePlanState } = await import("../../src/ui/lib/usePlanState");
    const { result } = renderHook(() => usePlanState());
    await waitFor(() => expect(result.current.whatIfScenarios.length).toBe(1));
    act(() => result.current.setScenarioId("w1"));
    return result;
  };

  test("a failed goals read with a ticked goal flags it", async () => {
    listScenariosUI.mockResolvedValue([houseWhatIf] as never);
    listWhatIfsUI.mockResolvedValue([ticked] as never);
    listGoalsUI.mockRejectedValue(new Error("down") as never);
    const result = await open();
    await waitFor(() => expect(result.current.goalCostsMissing).toBe(true));
  });

  test("a failed goals read changes nothing for a what-if with no ticked goal", async () => {
    listScenariosUI.mockResolvedValue([houseWhatIf] as never);
    listWhatIfsUI.mockResolvedValue([unticked] as never);
    listGoalsUI.mockRejectedValue(new Error("down") as never);
    const result = await open();
    await waitFor(() => expect(listGoalsUI).toHaveBeenCalled());
    expect(result.current.goalCostsMissing).toBe(false);
  });

  test("a good goals read is never flagged, and Real numbers never are", async () => {
    listScenariosUI.mockResolvedValue([houseWhatIf] as never);
    listWhatIfsUI.mockResolvedValue([ticked] as never);
    const result = await open();
    await waitFor(() => expect(listGoalsUI).toHaveBeenCalled());
    expect(result.current.goalCostsMissing).toBe(false);
    act(() => result.current.setScenarioId(null));
    expect(result.current.goalCostsMissing).toBe(false);
  });
});

// The app-wide budget is the plan whose year holds
// today, not the lowest id.
describe("which plan", () => {
  test("in January 2027 with plans for 2026 and 2027, the app opens on 2027", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 0, 5, 12));
    try {
      listPlansUI.mockResolvedValue([
        { id: "plan-2026", name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" },
        { id: "plan-2027", name: "2027", startDate: "2027-01-01", endDate: "2027-12-31" },
      ] as never);
      const { usePlanState } = await import("../../src/ui/lib/usePlanState");
      const { result } = renderHook(() => usePlanState());
      await waitFor(() => expect(result.current.planId).toBe("plan-2027"));
    } finally {
      vi.useRealTimers();
    }
  });
});

// A budget started for this year becomes the app-wide budget on refresh.
describe("refresh picks up a new budget", () => {
  test("January 2027 with only 2026, then 2027 is started: refresh moves the app to 2027", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 0, 5, 12));
    try {
      listPlansUI.mockResolvedValue([{ id: "plan-2026", name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" }] as never);
      const { usePlanState } = await import("../../src/ui/lib/usePlanState");
      const { result } = renderHook(() => usePlanState());
      await waitFor(() => expect(result.current.planId).toBe("plan-2026"));
      listPlansUI.mockResolvedValue([
        { id: "plan-2026", name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" },
        { id: "plan-2027", name: "2027", startDate: "2027-01-01", endDate: "2027-12-31" },
      ] as never);
      act(() => result.current.refresh());
      await waitFor(() => expect(result.current.planId).toBe("plan-2027"));
    } finally {
      vi.useRealTimers();
    }
  });
});
