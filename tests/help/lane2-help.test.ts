// tests/help/lane2-help.test.ts
// The help follows the screens. The Dashboard article walks
// the new order and says to open Top categories; Transactions covers notes, This
// repeats, the Recurring column, Recent categorizations and Undo.
import { expect, test } from "vitest";
import { DASHBOARD_HELP } from "../../src/help/screens/dashboard";
import { SHORT_HELP } from "../../src/help/screens/short";

const dashboard = DASHBOARD_HELP[0];
const all = SHORT_HELP.find((s) => s.key === "transactions.all")!;
const recurring = SHORT_HELP.find((s) => s.key === "recurring.charges")!;
const text = (x: unknown) => JSON.stringify(x);

test("the Dashboard's numbers are explained in the order the screen shows them", () => {
  expect(dashboard.numbers!.map((n) => n.label)).toEqual([
    "Month bar",
    "Spending by day",
    "Spent this month",
    "Left over so far",
    "Top categories",
    "Budget against actual",
    "Income this month",
    "Waiting on you",
    "Drawable",
    "Monthly budget",
    "Held back",
    "Average spent, last 12 months",
    "Recurring",
    "Goals",
    "Fixed costs (budget)",
    "Variable costs (budget)",
    "Synced, rules, Reviewed, accounts",
  ]);
});

test("Top categories says it starts folded and is remembered, and Check the month says to open it", () => {
  const top = dashboard.numbers!.find((n) => n.label === "Top categories")!;
  expect(top.how).toMatch(/starts folded/);
  expect(top.how).toMatch(/remembered in this browser/);
  const check = dashboard.howTo!.find((h) => h.title === "Check the month")!;
  expect(check.steps.join(" ")).toMatch(/Open Top categories/);
  expect(check.steps[0]).toMatch(/Spending by day/);
});

test("filing from Waiting on you names the note, This repeats, Undo and Recent categorizations", () => {
  const home = dashboard.howTo!.find((h) => h.title === "Give a waiting transaction a home")!.steps.join(" ");
  for (const words of ["Note", "This repeats", "Undo", "Recent categorizations"]) expect(home).toContain(words);
});

test("Transactions covers notes, This repeats, the Recurring heading, Recent categorizations and Undo", () => {
  const t = text(all);
  for (const words of ["note icon", "This repeats", "under the Recurring heading", "Recent categorizations", "Undo", "searches notes"]) {
    expect(t).toContain(words);
  }
  // A filing can now be undone, so the old "cannot be deleted" limit is gone.
  expect(t).not.toMatch(/A correction cannot be deleted/);
});

test("the Recurring screen names This repeats as a second way to add a charge", () => {
  expect(text(recurring)).toContain("This repeats");
});

test("no dashes in any of it", () => {
  expect(text([dashboard, all, recurring])).not.toMatch(/[–—]| - /);
});
