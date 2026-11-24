// @vitest-environment jsdom
// tests/ui/AppSidebar.test.tsx
//
// The persistent navigation. The whole point of this rework is that every
// destination is visible without clicking first, so the headline test is a
// count: all of them, on screen, at once.
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
