// @vitest-environment jsdom
// tests/ui/equation-bar-collapsed.test.tsx
//
// The desktop bar's fold is remembered on this device, and survives browser storage
// that throws.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useEquationBarCollapsed } from "../../src/ui/shell/EquationBar";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

test("folding is remembered, and starts open", () => {
  const { result, unmount } = renderHook(() => useEquationBarCollapsed());
  expect(result.current[0]).toBe(false);
  act(() => result.current[1](true));
  expect(result.current[0]).toBe(true);
  expect(window.localStorage.getItem("equation-bar-collapsed")).toBe("true");
  unmount();
  expect(renderHook(() => useEquationBarCollapsed()).result.current[0]).toBe(true);
});

test("storage that throws still folds, just not remembered", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const { result } = renderHook(() => useEquationBarCollapsed());
  expect(result.current[0]).toBe(false);
  act(() => result.current[1](true));
  expect(result.current[0]).toBe(true);
});
