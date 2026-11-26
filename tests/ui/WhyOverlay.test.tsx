// @vitest-environment jsdom
// tests/ui/WhyOverlay.test.tsx
//
// The story of the name, played inside the app. jsdom has no canvas, so these tests cover the
// controls, not the drawing (that is checked in a real browser).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import WhyOverlay, { WHY_END_HINT } from "../../src/why/WhyOverlay";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const overlay = () => screen.getByRole("dialog", { name: "Skallary" });

test("opens as a full-window dialog", () => {
  render(<WhyOverlay onClose={() => {}} />);
  expect(overlay().getAttribute("aria-modal")).toBe("true");
});

test("Esc closes", () => {
  const onClose = vi.fn();
  render(<WhyOverlay onClose={onClose} />);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("keys pressed during the show do not reach the rest of the app", () => {
  const app = vi.fn();
  window.addEventListener("keydown", app);
  try {
    render(<WhyOverlay onClose={() => {}} />);
    fireEvent.keyDown(document.body, { key: " " });
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(app).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("keydown", app);
  }
});

test("a click during the show moves on; it does not close", () => {
  const onClose = vi.fn();
  render(<WhyOverlay onClose={onClose} />);
  act(() => { vi.advanceTimersByTime(500); });
  fireEvent.click(overlay());
  fireEvent.keyDown(document.body, { key: " " });
  expect(onClose).not.toHaveBeenCalled();
});

test("once the name is on screen, a click closes", () => {
  const onClose = vi.fn();
  render(<WhyOverlay onClose={onClose} />);
  // Space six times: field, scale, granary, coin, words, merge -> the name.
  for (let i = 0; i < 6; i++) {
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.keyDown(document.body, { key: " " });
  }
  act(() => { vi.advanceTimersByTime(100); });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(overlay());
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("once the name is on screen, any key closes; before that, other keys do nothing", () => {
  const onClose = vi.fn();
  render(<WhyOverlay onClose={onClose} />);
  act(() => { vi.advanceTimersByTime(100); });
  fireEvent.keyDown(document.body, { key: "a" });
  expect(onClose).not.toHaveBeenCalled();
  for (let i = 0; i < 6; i++) {
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.keyDown(document.body, { key: " " });
  }
  act(() => { vi.advanceTimersByTime(100); });
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(document.body, { key: "a" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("the ending says to press any key", () => {
  expect(WHY_END_HINT).toBe("press any key to exit");
});

test("the page behind cannot scroll while the show is open, and can again after", () => {
  document.documentElement.style.overflow = "";
  const { unmount } = render(<WhyOverlay onClose={() => {}} />);
  expect(document.documentElement.style.overflow).toBe("hidden");
  unmount();
  expect(document.documentElement.style.overflow).toBe("");
});
