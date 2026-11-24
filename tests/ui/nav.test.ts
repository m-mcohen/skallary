// tests/ui/nav.test.ts
//
// The nav manifest is the single source of truth for the sidebar, the
// page title, the sub-tab strip, and route validation. These tests pin the
// invariants the shell relies on, and pin resolveRoute's repair behaviour --
// a bad hash must land somewhere real, never on a blank screen.
import { describe, expect, test } from "vitest";
import { DEFAULT_SECTION } from "../../src/ui/shell/router";
import { findNav, GROUP_LABELS, NAV, resolveRoute } from "../../src/ui/shell/nav";

describe("NAV", () => {
  test("section ids are unique", () => {
    const ids = NAV.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the default section exists in the manifest", () => {
    expect(findNav(DEFAULT_SECTION)).toBeDefined();
  });

  test("every item has a label and an icon", () => {
    for (const item of NAV) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon).toBeTruthy();
    }
  });

  test("every group used by an item has a label entry", () => {
    for (const item of NAV) {
      expect(GROUP_LABELS).toHaveProperty(item.group);
    }
  });

  test("tab ids are unique within an item", () => {
    for (const item of NAV) {
      if (!item.tabs) continue;
      const ids = item.tabs.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("an item declaring tabs declares at least two", () => {
    // One tab is not a choice; it is chrome pretending to be one.
    for (const item of NAV) {
      if (item.tabs) expect(item.tabs.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("transactions is in the manifest", () => {
    expect(findNav("transactions")).toBeDefined();
  });

  test("reports and recurring are in the manifest; Bills became Recurring and old links land on it", () => {
    expect(findNav("reports")).toBeDefined();
    expect(findNav("recurring")!.label).toBe("Recurring");
    expect(findNav("bills")).toBeUndefined();
    expect(resolveRoute({ section: "bills", tab: null }).item.id).toBe("recurring");
  });

  test("the old Budget, Yearly costs link lands on Recurring, Yearly bills", () => {
    const { item, tab } = resolveRoute({ section: "budget", tab: "yearly" });
    expect(item.id).toBe("recurring");
    expect(tab?.id).toBe("yearly");
  });

  // Balances and Net worth became one page.
  test("Accounts is one page with no tabs; Net worth is not its own entry", () => {
    expect(findNav("networth")).toBeUndefined();
    expect(findNav("accounts")!.tabs).toBeUndefined();
  });

  test("Settings gains an Accounts tab after Bank connection", () => {
    // Merchants joins after Mappings.
    expect(findNav("settings")!.tabs!.map((t) => t.label)).toEqual(["Bank connection", "Accounts", "Mappings", "Merchants", "Salary", "Guide", "Appearance", "Household", "About"]);
  });

  test("an old Net worth link lands on Accounts", () => {
    const { item, tab } = resolveRoute({ section: "networth", tab: null });
    expect(item.id).toBe("accounts");
    expect(tab).toBeNull();
  });

  test("old Accounts, Balances and Accounts, Net worth links land on Accounts", () => {
    for (const old of ["balances", "networth"]) {
      const { item, tab } = resolveRoute({ section: "accounts", tab: old });
      expect(item.id).toBe("accounts");
      expect(tab).toBeNull();
    }
  });

  // 15 entries became 13.
  test("What if replaces Scenarios and Lifestyle, under Model, and old links land on it", () => {
    expect(findNav("scenarios")).toBeUndefined();
    expect(findNav("lifestyle")).toBeUndefined();
    const whatIf = findNav("whatif")!;
    expect(whatIf.label).toBe("What if");
    expect(whatIf.group).toBe("model");
    expect(whatIf.tabs).toBeUndefined();
    expect(resolveRoute({ section: "lifestyle", tab: "compare" }).item.id).toBe("whatif");
    expect(resolveRoute({ section: "scenarios", tab: null }).item.id).toBe("whatif");
    // Runway and Wealth became one Forecast entry, so 12 became 11.
    expect(NAV.filter((i) => i.id !== "help").length).toBe(11);
  });

  // Long-term lost its Acquisition tab.
  // Wealth itself is retired, so every old Long-term link lands on Forecast.
  test("Acquisition and Long-term are gone, and every old Long-term link lands on Forecast", () => {
    expect(findNav("long-term")).toBeUndefined();
    expect(JSON.stringify(NAV.map((i) => [i.label, i.tabs?.map((t) => t.label)]))).not.toMatch(/Acquisition|Long-term/);
    for (const tab of [null, "acquisition", "wealth", "nonsense"]) {
      const { item, tab: landed } = resolveRoute({ section: "long-term", tab });
      expect(item.id, `long-term/${tab}`).toBe("forecast");
      expect(landed).toBeNull();
    }
  });

  // Wealth is retired and Runway becomes
  // Forecast, under Model, in Wealth's place. Plan loses its Runway entry.
  test("Forecast sits under Model in Wealth's place; Runway and Wealth are gone from the sidebar", () => {
    const forecast = findNav("forecast")!;
    expect(forecast.label).toBe("Forecast");
    expect(forecast.group).toBe("model");
    expect(forecast.tabs).toBeUndefined();
    expect(findNav("runway")).toBeUndefined();
    expect(findNav("wealth")).toBeUndefined();
    expect(NAV.filter((i) => i.group === "model").map((i) => i.label)).toEqual(["What if", "Forecast"]);
    expect(NAV.filter((i) => i.group === "plan").map((i) => i.label)).toEqual(["Budget", "Recurring", "Goals"]);
    expect(JSON.stringify(NAV.map((i) => [i.label, i.tabs?.map((t) => t.label)]))).not.toMatch(/Runway|Wealth/);
  });

  test("old Runway and Wealth links land on Forecast, whatever tab they carry", () => {
    for (const section of ["runway", "wealth"]) {
      for (const tab of [null, "nonsense"]) {
        const { item, tab: landed } = resolveRoute({ section, tab });
        expect(item.id, `${section}/${tab}`).toBe("forecast");
        expect(landed).toBeNull();
      }
    }
  });
});

describe("which screens use the what-if", () => {
  // Runway became Forecast and keeps following the what-if.
  test("only Dashboard, Forecast and What if follow it; every other screen says it does not", () => {
    expect(NAV.filter((n) => n.usesWhatIf).map((n) => n.id).sort()).toEqual(["dashboard", "forecast", "whatif"]);
  });
});

describe("resolveRoute", () => {
  test("resolves a known section with no tabs", () => {
    const { item, tab } = resolveRoute({ section: "forecast", tab: null });
    expect(item.id).toBe("forecast");
    expect(tab).toBeNull();
  });

  test("repairs an unknown section to the default", () => {
    const { item } = resolveRoute({ section: "nope-not-real", tab: null });
    expect(item.id).toBe(DEFAULT_SECTION);
  });

  test("defaults a tabbed section to its first tab", () => {
    const { item, tab } = resolveRoute({ section: "budget", tab: null });
    expect(item.id).toBe("budget");
    expect(tab?.id).toBe(item.tabs?.[0].id);
  });

  test("repairs an unknown tab to the first tab", () => {
    const { tab } = resolveRoute({ section: "budget", tab: "not-a-tab" });
    expect(tab?.id).toBe(findNav("budget")?.tabs?.[0].id);
  });

  test("ignores a tab on a section that has none", () => {
    const { item, tab } = resolveRoute({ section: "forecast", tab: "stray" });
    expect(item.id).toBe("forecast");
    expect(tab).toBeNull();
  });
});
