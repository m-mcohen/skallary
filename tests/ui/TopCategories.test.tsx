// @vitest-environment jsdom
// tests/ui/TopCategories.test.tsx
// Top categories folds away. Closed, one line: the top three
// and how many more. Starts closed; the choice is remembered in this browser.
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TopCategories, { TOP_CATEGORIES_KEY } from "../../src/ui/dashboard/TopCategories";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const items = [
  { category: "Groceries", cents: 61240 },
  { category: "Restaurants & Bars", cents: 34010 },
  { category: "Gas", cents: 18800 },
  { category: "Gifts", cents: 4500 },
  { category: "Shopping", cents: 2000 },
];
const plain = (c: { cents: number }) => <span>{(c.cents / 100).toFixed(2)}</span>;
const shown = () => screen.queryByTestId("month-top-Gifts");

test("closed by default: one line with the top three and how many more", () => {
  render(<TopCategories items={items} renderAmount={plain} emptyText="Nothing spent yet this month." />);
  expect(screen.getByTestId("top-categories-summary").textContent).toBe(
    "Groceries $612.40, Restaurants & Bars $340.10, Gas $188.00, +2 more"
  );
  expect(shown()).toBeNull();
  expect(screen.getByRole("button", { name: /Top categories/ }).getAttribute("aria-expanded")).toBe("false");
});

test("three or fewer: no '+ more'", () => {
  render(<TopCategories items={items.slice(0, 2)} renderAmount={plain} emptyText="" />);
  expect(screen.getByTestId("top-categories-summary").textContent).toBe("Groceries $612.40, Restaurants & Bars $340.10");
});

test("nothing spent says so, open or closed", () => {
  render(<TopCategories items={[]} renderAmount={plain} emptyText="Nothing spent yet this month." />);
  expect(screen.getByText("Nothing spent yet this month.")).toBeTruthy();
});

test("opening shows the full list, and the choice is remembered in this browser", async () => {
  const user = userEvent.setup();
  const { unmount } = render(<TopCategories items={items} renderAmount={plain} emptyText="" />);
  await user.click(screen.getByRole("button", { name: /Top categories/ }));
  expect(shown()).toBeTruthy();
  expect(screen.queryByTestId("top-categories-summary")).toBeNull();
  expect(localStorage.getItem(TOP_CATEGORIES_KEY)).toBe("open");
  unmount();
  render(<TopCategories items={items} renderAmount={plain} emptyText="" />);
  expect(shown()).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /Top categories/ }));
  expect(localStorage.getItem(TOP_CATEGORIES_KEY)).toBe("closed");
});

test("a browser that refuses storage still folds and opens", async () => {
  const user = userEvent.setup();
  const get = Storage.prototype.getItem;
  const set = Storage.prototype.setItem;
  Storage.prototype.getItem = () => {
    throw new Error("blocked");
  };
  Storage.prototype.setItem = () => {
    throw new Error("blocked");
  };
  try {
    render(<TopCategories items={items} renderAmount={plain} emptyText="" />);
    expect(shown()).toBeNull();
    await user.click(screen.getByRole("button", { name: /Top categories/ }));
    expect(shown()).toBeTruthy();
  } finally {
    Storage.prototype.getItem = get;
    Storage.prototype.setItem = set;
  }
});
