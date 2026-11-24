// tests/help/bank-problems-help.test.ts
//
// A bank that needs a sign-in, or has sent nothing new for more than
// 3 days, is said loudly after Sync and on every screen. Help, the glossary and
// "This page answers" change in the same change.
import { describe, expect, test } from "vitest";
import { findTerm } from "../../src/help/glossary";
import { helpByKey } from "../../src/help";

const text = (key: string) => JSON.stringify(helpByKey(key));

describe("bank problems in the help", () => {
  test("the glossary defines a bank that needs a sign-in and a bank with no new data", () => {
    expect(findTerm("needs-sign-in")!.term).toBe("Needs a sign-in");
    expect(findTerm("needs-sign-in")!.definition).toMatch(/SimpleFIN Bridge site/);
    expect(findTerm("needs-sign-in")!.definition).toMatch(/other banks still come in/);
    expect(findTerm("no-new-data")!.term).toBe("No new data");
    expect(findTerm("no-new-data")!.definition).toMatch(/more than 3 days old/);
    expect(findTerm("no-new-data")!.definition).toMatch(/reported no problem/);
    expect(findTerm("no-new-data")!.definition).toMatch(/Archived accounts/);
  });

  test("Sync says what happens when a bank needs you: the red button, the box, the reload on Close, the banner", () => {
    const sync = findTerm("sync")!.definition;
    expect(sync).toMatch(/Sync button turns red/);
    expect(sync).toMatch(/box lists each bank/);
    expect(sync).toMatch(/refreshes when you close it/);
    expect(sync).toMatch(/red banner under the top bar/);
    expect(sync).toMatch(/until a sync comes back clean/);
    expect(sync).toMatch(/hides it until the next sync/);
  });

  // A short article carries at most five terms and this one had five,
  // so the two new terms are named by the Dashboard article, whose footer line shows them.
  test("Settings, Bank connection explains the list, and its answers line asks which banks need you", () => {
    const s = helpByKey("settings.connection")!;
    expect(s.answers).toBe("Is the bank feed working, which banks need you, and how are transactions sorted?");
    expect(s.termIds).toContain("sync");
    expect(text("settings.connection")).toMatch(/needs a sign-in, or has sent no new data for more than 3 days/);
    expect(s.howTo!.map((h) => h.title)).toContain("Fix a bank that needs you");
    expect(text("settings.connection")).toMatch(/Open SimpleFIN Bridge/);
  });

  test("the Dashboard says where a bank that needs you is named, and names both terms", () => {
    expect(text("dashboard")).toMatch(/named in red beside Synced/);
    expect(helpByKey("dashboard")!.termIds).toEqual(expect.arrayContaining(["needs-sign-in", "no-new-data"]));
  });
});
