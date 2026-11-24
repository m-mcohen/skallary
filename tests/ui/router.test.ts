// @vitest-environment jsdom
// tests/ui/router.test.ts
//
// The hash router. Pins the parse/format round trip, the fallbacks that keep
// a malformed or empty hash from blanking the app, and the fact that
// navigating writes a real history entry so the back button works.
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_SECTION, formatRoute, navigate, parseHash } from "../../src/ui/shell/router";

afterEach(() => {
  window.location.hash = "";
});

describe("parseHash", () => {
  test("reads a bare section", () => {
    expect(parseHash("#/budget")).toEqual({ section: "budget", tab: null });
  });

  test("reads a section and a tab", () => {
    expect(parseHash("#/budget/charts")).toEqual({ section: "budget", tab: "charts" });
  });

  test("falls back to the default section when the hash is empty", () => {
    expect(parseHash("")).toEqual({ section: DEFAULT_SECTION, tab: null });
    expect(parseHash("#")).toEqual({ section: DEFAULT_SECTION, tab: null });
    expect(parseHash("#/")).toEqual({ section: DEFAULT_SECTION, tab: null });
  });

  test("ignores extra path segments rather than failing", () => {
    expect(parseHash("#/budget/charts/extra/junk")).toEqual({
      section: "budget",
      tab: "charts",
    });
  });

  test("decodes percent-encoded segments", () => {
    expect(parseHash("#/long-term/wealth%20assumptions")).toEqual({
      section: "long-term",
      tab: "wealth assumptions",
    });
  });

  test("does not treat a query string as part of the tab", () => {
    expect(parseHash("#/transactions?q=rent")).toEqual({
      section: "transactions",
      tab: null,
    });
  });
});

describe("formatRoute", () => {
  test("round-trips a section", () => {
    expect(formatRoute({ section: "budget", tab: null })).toBe("#/budget");
    expect(parseHash(formatRoute({ section: "budget", tab: null }))).toEqual({
      section: "budget",
      tab: null,
    });
  });

  test("round-trips a section and tab", () => {
    expect(formatRoute({ section: "budget", tab: "charts" })).toBe("#/budget/charts");
    expect(parseHash(formatRoute({ section: "budget", tab: "charts" }))).toEqual({
      section: "budget",
      tab: "charts",
    });
  });
});

describe("navigate", () => {
  test("writes the hash so the browser records a history entry", () => {
    navigate({ section: "runway", tab: null });
    expect(window.location.hash).toBe("#/runway");
  });

  test("navigating to the current route does not stack duplicate history entries", () => {
    navigate({ section: "runway", tab: null });
    const before = window.history.length;
    navigate({ section: "runway", tab: null });
    expect(window.history.length).toBe(before);
  });
});
