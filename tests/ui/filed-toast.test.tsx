// @vitest-environment jsdom
// tests/ui/filed-toast.test.tsx
// After each filing, "Filed Shell as Gas." with an Undo button.
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { Toaster } from "../../src/components/ui/sonner";
import { FILED_TOAST_MS, showFiled } from "../../src/ui/lib/filed-toast";

beforeAll(() => {
  // jsdom has no pointer capture; sonner calls it when a toast is pressed (for swiping).
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

afterEach(() => {
  act(() => toast.dismiss());
  cleanup();
});

test("the toast says what was filed, stays about 10 seconds, and its Undo runs the undo once", async () => {
  const user = userEvent.setup();
  const undo = vi.fn(async () => {});
  render(<Toaster />);
  act(() => showFiled("Filed Shell as Gas.", undo));
  expect(await screen.findByText("Filed Shell as Gas.")).toBeTruthy();
  expect(FILED_TOAST_MS).toBe(10_000);
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("Undone.")).toBeTruthy();
});

test("a refused undo shows the server's own words", async () => {
  const user = userEvent.setup();
  render(<Toaster />);
  act(() => showFiled("Filed Shell as Gas.", async () => { throw new Error("That categorization is not in the list."); }));
  await user.click(await screen.findByRole("button", { name: "Undo" }));
  expect(await screen.findByText("That categorization is not in the list.")).toBeTruthy();
});
