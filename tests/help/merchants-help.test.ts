// tests/help/merchants-help.test.ts
//
// Help, the glossary and "This page answers" for the
// new pieces, in the same change. Settings gains a Merchants tab; Reports gains a
// page per merchant (a page under Reports, not a sidebar entry); Reports and
// Transactions say what changed.
import { describe, expect, test } from "vitest";

import { findTerm } from "../../src/help/glossary";
import { HELP_SCREENS, helpByKey, helpFor } from "../../src/help";
import { NAV, SUB_PAGES } from "../../src/ui/shell/nav";

describe("help for merchants", () => {
  test("Settings has a Merchants tab with its own article and answers line", () => {
    expect(NAV.find((i) => i.id === "settings")!.tabs!.map((t) => t.id)).toContain("merchants");
    const article = helpByKey("settings.merchants")!;
    expect(article).toBeTruthy();
    expect(article.answers).toBe("Which names are the same merchant, and what should each be called?");
    expect(article.termIds).toEqual(expect.arrayContaining(["merchant", "rename", "suggested-merge"]));
    expect(JSON.stringify(article)).toMatch(/Amazon Prime/);
    expect(JSON.stringify(article)).toMatch(/Zelle/);
  });

  test("the merchant page is a page under Reports, with its own article and answers line", () => {
    expect(SUB_PAGES).toEqual([{ section: "reports", page: "merchant", label: "Merchant" }]);
    expect(helpFor("reports", "merchant")?.key).toBe("reports.merchant");
    const article = helpByKey("reports.merchant")!;
    expect(article.answers).toBe("How much goes to this merchant, month by month?");
    expect(JSON.stringify(article)).toMatch(/complete months/);
    expect(HELP_SCREENS.map((s) => s.key)).toContain("reports.merchant");
  });

  test("Reports and Transactions say what changed", () => {
    expect(JSON.stringify(helpByKey("reports"))).toMatch(/Group by/);
    // Reports keeps its five terms (a short article has at most five); Merchant is defined
    // on the merchant page and on Settings, Merchants.
    expect(JSON.stringify(helpByKey("reports"))).toMatch(/a merchant's name opens its own page/);
    expect(JSON.stringify(helpByKey("transactions.all"))).toMatch(/Merchant column/);
  });

  test("the glossary defines Merchant, Rename and Suggested merge, and rules keep the bank's name", () => {
    expect(findTerm("merchant")!.definition).toMatch(/bank/);
    expect(findTerm("rename")!.definition).toMatch(/Rules and recurring charges still/);
    expect(findTerm("suggested-merge")!.definition).toMatch(/Accept/);
  });
});
