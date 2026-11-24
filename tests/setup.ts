// tests/setup.ts
//
// @testing-library/dom's findBy*/waitFor default to a 1000ms timeout. That is
// plenty for a single file, but the UI suite runs many jsdom environments in
// parallel and a component that mounts, fetches through a stubbed data layer
// and re-renders can exceed it purely from scheduling pressure -- three
// different tests (BudgetGrid, GoalsSection) failed this way while the code
// under test was correct, then passed alone.
//
// Raising the async timeout removes the false failures without weakening any
// assertion: a genuinely broken component still never resolves and still
// fails, just later. Test-level timeouts are untouched.
//
// 15s rather than a tighter number because the AG-Grid-backed BudgetGrid test
// was still exceeding 5s under a full parallel run while passing in ~2s alone
// -- the ceiling has to clear the worst scheduling case, not the typical one.
import { configure } from "@testing-library/dom";

configure({ asyncUtilTimeout: 15000 });

// jsdom implements no CSS object model beyond the basics, so `matchMedia` is
// simply absent. Anything rendering the sidebar reaches it through
// src/hooks/use-mobile.ts and throws "window.matchMedia is not a function"
// before a single assertion runs.
//
// The stub always reports "does not match", i.e. a desktop viewport, which is
// the right default: this is a desktop app launched from a Desktop shortcut,
// and jsdom's default width is a desktop width anyway. A test that needs the
// mobile branch should override this locally rather than widen the stub here.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    // Deprecated pair, still called by some libraries.
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
