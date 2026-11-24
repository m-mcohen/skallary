// @vitest-environment jsdom
// The theme switch: absent means follow the computer; Dark adds the class; "system" follows the OS live.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getThemeUI } from "../../src/ui/lib/db";
import { resolveDark, setThemePreference, startTheme } from "../../src/ui/lib/theme";

let osDark = false;
let fire: (() => void) | null = null;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  osDark = false;
  fire = null;
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return osDark; },
    addEventListener: (_: string, f: () => void) => { fire = f; },
    removeEventListener: () => {},
  }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});
afterEach(() => vi.unstubAllGlobals());

describe("theme", () => {
  it("absent means Match my computer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    expect(await getThemeUI({ base: "/api" })).toBe("system");
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
  });

  it("choosing Dark adds the dark class, Light removes it", () => {
    setThemePreference("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    setThemePreference("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("Match my computer follows a change of the computer's setting", () => {
    const stop = startTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    osDark = true;
    fire!();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    stop();
  });
});
