// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import BudgetBar from "../../src/ui/budget/BudgetBar";
import ChangeBar from "../../src/ui/budget/ChangeBar";

afterEach(() => cleanup());

test("the budget bar draws spent as a fill and the budget as a tick, red only when its tone is red", () => {
  render(<BudgetBar spentCents={50000} budgetCents={100000} tone="grey" label="Groceries: spent $500.00 of $1,000.00" />);
  const bar = screen.getByRole("img", { name: "Groceries: spent $500.00 of $1,000.00" });
  const fill = bar.querySelector("[data-part=fill]") as HTMLElement;
  expect(fill.style.width).toBe("50%");
  expect(fill.className).toContain("bg-budget-fill");
  expect((bar.querySelector("[data-part=tick]") as HTMLElement).style.left).toBe("calc(100% - 1px)");
  cleanup();
  render(<BudgetBar spentCents={120000} budgetCents={100000} tone="red" label="over" />);
  expect((screen.getByRole("img", { name: "over" }).querySelector("[data-part=fill]") as HTMLElement).className).toContain("bg-budget-red");
});

test("no budget, no tick", () => {
  render(<BudgetBar spentCents={5000} budgetCents={null} tone="grey" label="no budget" />);
  expect(screen.getByRole("img", { name: "no budget" }).querySelector("[data-part=tick]")).toBeNull();
});

test("the change bar grows left for less and right for more", () => {
  render(<ChangeBar changeCents={-5000} scaleCents={10000} tone="blue" label="less" />);
  const less = screen.getByRole("img", { name: "less" }).querySelector("[data-part=change]") as HTMLElement;
  expect(less.style.right).toBe("50%");
  expect(less.style.width).toBe("25%");
  expect(less.className).toContain("bg-budget-blue");
  cleanup();
  render(<ChangeBar changeCents={20000} scaleCents={10000} tone="red" label="more" />);
  const more = screen.getByRole("img", { name: "more" }).querySelector("[data-part=change]") as HTMLElement;
  expect(more.style.left).toBe("50%");
  expect(more.style.width).toBe("50%");
});

test("no change draws only the center line", () => {
  render(<ChangeBar changeCents={0} scaleCents={10000} tone="grey" label="same" />);
  expect(screen.getByRole("img", { name: "same" }).querySelector("[data-part=change]")).toBeNull();
});
