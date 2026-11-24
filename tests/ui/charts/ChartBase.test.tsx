// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

// jsdom has no layout, so every box is zero by zero: the component must make no chart there.
vi.mock("../../../src/ui/charts/register", () => ({ initChart: vi.fn(), connectCharts: vi.fn() }));
vi.mock("../../../src/ui/charts/looks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/ui/charts/looks")>();
  return { ...actual, readPalette: vi.fn(actual.readPalette) };
});

import ChartBase from "../../../src/ui/charts/ChartBase";
import { initChart } from "../../../src/ui/charts/register";
import { readPalette } from "../../../src/ui/charts/looks";
import type { ChartBaseProps } from "../../../src/ui/charts/types";

const props: ChartBaseProps = {
  title: "Monthly cash flow",
  description: "Income and expense for 12 months.",
  axis: "category",
  series: [{ id: "income", label: "Income", role: "actual", mark: "bar", points: [{ x: "2026-01", cents: 300000 }] }],
};

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  vi.mocked(initChart).mockClear();
  vi.mocked(readPalette).mockClear();
});

test("every chart has an accessible name and a one-sentence description", () => {
  render(<ChartBase {...props} />);
  const figure = screen.getByRole("img", { name: "Monthly cash flow" });
  const describedBy = figure.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  expect(document.getElementById(describedBy!)?.textContent).toBe("Income and expense for 12 months.");
});

test("a chart in a box with no size makes no instance and does not throw; unmounting is clean", () => {
  const { unmount } = render(<ChartBase {...props} />);
  expect(() => unmount()).not.toThrow();
  expect(initChart).not.toHaveBeenCalled();
});

test("the palette is read again when light and dark switch", async () => {
  render(<ChartBase {...props} />);
  const before = vi.mocked(readPalette).mock.calls.length;
  expect(before).toBeGreaterThan(0);
  await act(async () => { document.documentElement.classList.add("dark"); });
  await waitFor(() => expect(vi.mocked(readPalette).mock.calls.length).toBe(before + 1));
});
