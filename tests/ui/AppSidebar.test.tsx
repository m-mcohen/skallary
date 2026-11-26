// @vitest-environment jsdom
// tests/ui/AppSidebar.test.tsx
//
// The persistent navigation. The whole point of this rework is that every
// destination is visible without clicking first, so the headline test is a
// count: all of them, on screen, at once.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@/components/ui/sidebar";
import AppSidebar from "../../src/ui/shell/AppSidebar";
import { GROUP_LABELS, NAV } from "../../src/ui/shell/nav";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const renderSidebar = (activeSection = "dashboard") =>
  render(
    <SidebarProvider>
      <AppSidebar activeSection={activeSection} />
    </SidebarProvider>
  );

describe("AppSidebar", () => {
  test("every destination is visible at once", () => {
    renderSidebar();
    for (const item of NAV) {
      expect(screen.getByRole("link", { name: item.label })).toBeTruthy();
    }
  });

  test("renders each group heading", () => {
    renderSidebar();
    for (const label of Object.values(GROUP_LABELS)) {
      if (label) expect(screen.getByText(label)).toBeTruthy();
    }
  });

  test("marks the active item and only the active item", () => {
    renderSidebar("forecast");
    const active = screen
      .getAllByRole("link")
      .filter((el) => el.getAttribute("aria-current") === "page");
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toMatch(/Forecast/);
  });

  test("clicking an item navigates", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("link", { name: "Budget" }));
    expect(window.location.hash).toBe("#/budget");
  });

  test("items are real links so they can be opened in a new tab", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: "Budget" }).getAttribute("href")).toBe("#/budget");
  });
});

describe("the wheat logo", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const logo = () => screen.getByRole("button", { name: "Skallary" });
  const show = () => screen.queryByRole("dialog", { name: "Skallary" });

  test("holding the wheat for two seconds plays the show in the app", () => {
    renderSidebar();
    fireEvent.pointerDown(logo());
    act(() => { vi.advanceTimersByTime(1900); });
    expect(show()).toBeNull();
    act(() => { vi.advanceTimersByTime(100); });
    expect(show()).not.toBeNull();
  });

  test("nothing is sent to the server", () => {
    renderSidebar();
    fireEvent.pointerDown(logo());
    act(() => { vi.advanceTimersByTime(2000); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("Esc closes the show and the app is back", () => {
    renderSidebar();
    fireEvent.pointerDown(logo());
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.pointerUp(logo());
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(show()).toBeNull();
    expect(screen.getByRole("link", { name: "Budget" })).toBeTruthy();
  });

  test("after it fires, the ring pulses briefly and then clears, even once the button is let go", () => {
    renderSidebar();
    fireEvent.pointerDown(logo());
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.pointerUp(logo());
    const ring = () => logo().querySelector("svg")!;
    expect(ring().getAttribute("class")).toContain("animate-ping");
    act(() => { vi.advanceTimersByTime(3500); });
    expect(ring().getAttribute("class")).not.toContain("animate-ping");
  });

  test("pressing and holding on the show itself does not start another hold", () => {
    renderSidebar();
    fireEvent.pointerDown(logo());
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.pointerUp(logo());
    act(() => { vi.advanceTimersByTime(3500); });
    fireEvent.pointerDown(show()!);
    act(() => { vi.advanceTimersByTime(2500); });
    expect(logo().querySelector("svg")!.getAttribute("class")).not.toContain("animate-ping");
  });

  test("letting go early, or sliding off, opens nothing", () => {
    renderSidebar();
    fireEvent.pointerDown(logo());
    act(() => { vi.advanceTimersByTime(1500); });
    fireEvent.pointerUp(logo());
    fireEvent.pointerDown(logo());
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.pointerLeave(logo());
    act(() => { vi.advanceTimersByTime(5000); });
    expect(show()).toBeNull();
  });

  test("quick clicks open nothing", () => {
    renderSidebar();
    for (let i = 0; i < 5; i++) { fireEvent.pointerDown(logo()); fireEvent.pointerUp(logo()); fireEvent.click(logo()); }
    act(() => { vi.advanceTimersByTime(5000); });
    expect(show()).toBeNull();
  });

  test("at rest the ring draws nothing, not even the dot of its rounded end", () => {
    renderSidebar();
    const circle = () => logo().querySelector("circle")!;
    expect(circle().style.visibility).toBe("hidden");
    fireEvent.pointerDown(logo());
    expect(circle().style.visibility).toBe("visible");
    fireEvent.pointerUp(logo());
    expect(circle().style.visibility).toBe("hidden");
  });

  test("the logo is not a keyboard stop", () => {
    renderSidebar();
    expect(logo().getAttribute("tabindex")).toBe("-1");
  });
});
