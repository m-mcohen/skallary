// @vitest-environment jsdom
// tests/ui/guide-visibility.test.ts -- the store behind the "This page
// answers" switch. Mirrors
// tests/ui/usePlanState.test.tsx's pattern: db.ts mocked so no real fetch is
// made, the store itself exercised through its public functions.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getShowGuideLinesUI = vi.fn(async () => true);
const setShowGuideLinesUI = vi.fn(async () => {});
const loadDb = vi.fn(async () => ({}) as never);

vi.mock("../../src/ui/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/ui/lib/db")>();
  return {
    ...actual,
    loadDb: (...args: unknown[]) => loadDb(...args),
    getShowGuideLinesUI: (...args: unknown[]) => getShowGuideLinesUI(...(args as [never])),
    setShowGuideLinesUI: (...args: unknown[]) => setShowGuideLinesUI(...(args as [never, never])),
  };
});

afterEach(() => {
  vi.clearAllMocks();
  getShowGuideLinesUI.mockResolvedValue(true as never);
  setShowGuideLinesUI.mockResolvedValue(undefined as never);
});

async function freshStore() {
  vi.resetModules();
  return import("../../src/ui/lib/guide-visibility");
}

describe("useShowGuideLines", () => {
  test("reads shown by default before the server answers, then follows what it says", async () => {
    getShowGuideLinesUI.mockResolvedValue(false as never);
    const { useShowGuideLines, configureGuideLinesStore } = await freshStore();
    configureGuideLinesStore();
    const { result } = renderHook(() => useShowGuideLines());
    expect(result.current).toBe(true); // optimistic default: shown
    await waitFor(() => expect(result.current).toBe(false));
  });

  test("a server that cannot be reached still resolves to shown", async () => {
    getShowGuideLinesUI.mockRejectedValue(new Error("offline") as never);
    const { useShowGuideLines, configureGuideLinesStore } = await freshStore();
    configureGuideLinesStore();
    const { result } = renderHook(() => useShowGuideLines());
    await waitFor(() => expect(getShowGuideLinesUI).toHaveBeenCalled());
    expect(result.current).toBe(true);
  });
});

describe("setShowGuideLines", () => {
  test("updates every subscriber at once, and saves through the data layer", async () => {
    const { useShowGuideLines, setShowGuideLines, configureGuideLinesStore } = await freshStore();
    configureGuideLinesStore();
    const a = renderHook(() => useShowGuideLines());
    const b = renderHook(() => useShowGuideLines());
    await act(async () => {
      await setShowGuideLines(false);
    });
    expect(a.result.current).toBe(false);
    expect(b.result.current).toBe(false);
    expect(setShowGuideLinesUI).toHaveBeenCalledWith(expect.anything(), false);
  });

  test("a save that fails reverts the value and rethrows", async () => {
    const { useShowGuideLines, setShowGuideLines, configureGuideLinesStore } = await freshStore();
    configureGuideLinesStore();
    setShowGuideLinesUI.mockRejectedValue(new Error("network down") as never);
    const { result } = renderHook(() => useShowGuideLines());
    await waitFor(() => expect(result.current).toBe(true));
    await expect(act(async () => setShowGuideLines(false))).rejects.toThrow("network down");
    expect(result.current).toBe(true);
  });
});
