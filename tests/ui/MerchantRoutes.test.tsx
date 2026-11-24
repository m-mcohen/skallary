// @vitest-environment jsdom
// tests/ui/MerchantRoutes.test.tsx
//
// Merchant details and rename settings have separate routes and page descriptions.
// The server is unreachable under jsdom; the shell and the line render regardless.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import AppShell from "../../src/ui/shell/AppShell";

beforeEach(() => {
  window.location.hash = "";
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("the merchant routes", () => {
  test("a merchant's page answers its own question, under Reports", async () => {
    window.location.hash = "#/reports/merchant?name=Target&back=%23%2Freports";
    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByText("This page answers: How much goes to this merchant, month by month?")).toBeTruthy();
    });
    expect(screen.getByTestId("page-title").textContent).toBe("Reports");
    expect(screen.queryByText("This page answers: How much went out, where did it go, over the period or one month of it, and how does it compare?")).toBeNull();
  });

  test("Settings, Merchants is a tab with its own line", async () => {
    window.location.hash = "#/settings/merchants";
    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByText("This page answers: Which names are the same merchant, and what should each be called?")).toBeTruthy();
    });
    expect(screen.getByRole("tab", { name: "Merchants" }).getAttribute("aria-selected")).toBe("true");
  });

  test("plain Reports still answers its own question", async () => {
    window.location.hash = "#/reports";
    render(<AppShell />);
    await waitFor(() => {
      expect(screen.getByText("This page answers: How much went out, where did it go, over the period or one month of it, and how does it compare?")).toBeTruthy();
    });
  });
});
