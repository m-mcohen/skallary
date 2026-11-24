// @vitest-environment jsdom
// tests/ui/StarterRulesChecklist.test.tsx -- choice c sends exactly the ticked stores' rules, every
// spelling of a ticked store included; nothing ticked is choice b.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { STARTER_RULES } from "../../src/domain/starter-set";

const applyStarterFilingUI = vi.fn(async () => ({ categoriesAdded: 3, rulesAdded: 1 }));
vi.mock("../../src/ui/lib/db-setup", () => ({ applyStarterFilingUI: (...a: unknown[]) => applyStarterFilingUI(...(a as [])) }));

const { StarterRulesChecklist } = await import("../../src/ui/setup/StarterRulesChecklist");

afterEach(() => { cleanup(); applyStarterFilingUI.mockClear(); });

test("ticking a store sends all of its rules and no others", async () => {
  render(<StarterRulesChecklist />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Amazon" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Netflix" }));
  await userEvent.click(screen.getByRole("button", { name: "File 2 stores this way" }));
  const ids = STARTER_RULES.filter((r) => r.name === "Amazon" || r.name === "Netflix").map((r) => r.id);
  expect(ids.length).toBe(3);
  expect(applyStarterFilingUI).toHaveBeenCalledWith("checklist", ids);
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Added 3 categories and 1 rule."));
});

test("with nothing ticked, only the categories are added", async () => {
  render(<StarterRulesChecklist />);
  await userEvent.click(screen.getByRole("button", { name: "Add the categories only" }));
  expect(applyStarterFilingUI).toHaveBeenCalledWith("categories-only");
});
