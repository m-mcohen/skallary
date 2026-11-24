// @vitest-environment jsdom
// tests/ui/OverlayBanner.test.tsx
// While a what-if is on, a banner under
// the top bar says so on every screen and turns it off.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OverlayBanner from "../../src/ui/shell/OverlayBanner";

afterEach(cleanup);

test("while a what-if is on, the banner names it and turns it off", async () => {
  const off = vi.fn();
  render(<OverlayBanner name="Offer A $120k" onTurnOff={off} />);
  const banner = screen.getByRole("status");
  expect(banner.textContent).toBe("What-if on: Offer A $120k. Numbers include it.Turn off");
  await userEvent.setup().click(screen.getByRole("button", { name: "Turn off" }));
  expect(off).toHaveBeenCalledOnce();
});

// Budget, Reports, Goals and the rest ignore the what-if,
// yet the banner told them "Numbers include it".
test("on a screen that ignores the what-if, the banner says so", () => {
  render(<OverlayBanner name="Offer A $120k" usesWhatIf={false} onTurnOff={() => {}} />);
  const banner = screen.getByRole("status");
  expect(banner.textContent).toBe("What-if on: Offer A $120k. This screen does not use the what-if.Turn off");
});

test("with Real numbers there is no banner", () => {
  const { container } = render(<OverlayBanner name={null} onTurnOff={() => {}} />);
  expect(container.textContent).toBe("");
  expect(screen.queryByRole("status")).toBeNull();
});

test("colored from the theme tokens, with no motion", () => {
  render(<OverlayBanner name="Offer A $120k" onTurnOff={() => {}} />);
  const cls = screen.getByRole("status").className;
  expect(cls).toMatch(/bg-primary\/10/);
  expect(cls).not.toMatch(/animate|transition/);
  expect(cls).not.toMatch(/#[0-9a-f]{3,6}|sky-|blue-|amber-/i);
});

// when the goals could not be read, say the what-if's figures leave goal costs out.
test("when goal costs could not be read, the banner says they are left out", () => {
  render(<OverlayBanner name="House" goalCostsMissing onTurnOff={() => {}} />);
  expect(screen.getByRole("status").textContent).toContain("Goals could not be read, so their rows are left out of these figures.");
});

test("when goal costs were read, there is no such note", () => {
  render(<OverlayBanner name="House" onTurnOff={() => {}} />);
  expect(screen.getByRole("status").textContent).not.toContain("Goal costs");
});
