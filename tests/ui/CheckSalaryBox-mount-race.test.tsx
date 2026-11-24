// @vitest-environment jsdom
// tests/ui/CheckSalaryBox-mount-race.test.tsx
//
// The flaky "rent raised twice" test in WhatIfSection.test.tsx
// typed into Check a salary the moment the box appeared and, once in a while under load, found
// the box empty and no results, for the full 15 seconds. Cause: the box set its text from the
// what-if's salary in an effect that also ran on mount. React runs that mount effect a beat after
// the box reaches the screen, so a salary typed in that beat was overwritten with the starting
// value. This test types in exactly that beat (React Testing Library's act would flush the effect
// first and hide it), so it fails every time on the old code, not one run in ten.
import { afterEach, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";

import CheckSalaryBox from "../../src/ui/what-if/CheckSalaryBox";
import { DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import { whatIfLadder, type WhatIf } from "../../src/domain/what-if";

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const whatIf: WhatIf = { scenarioId: "w1", salaryGrossAnnualCents: null, salaryFromPeriod: null, changes: [], rows: [] };
const LINES = [{ planId: "p1", planningCategory: "Rent", period: null, amountCents: 200_000 }];

/** Resolves the instant the node exists, from a DOM mutation, with no React flush in between. */
const whenInputAppears = () =>
  new Promise<HTMLInputElement>((resolve) => {
    const find = () => host!.querySelector<HTMLInputElement>("#wi-check");
    const found = find();
    if (found) return resolve(found);
    const watch = new MutationObserver(() => {
      const el = find();
      if (el) {
        watch.disconnect();
        resolve(el);
      }
    });
    watch.observe(host!, { childList: true, subtree: true });
  });

function typeInto(input: HTMLInputElement, value: string) {
  // The way a browser delivers typing: set the value, then a real input event.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("a salary typed the instant the box appears is kept, not reset by the mount", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const ladder = whatIfLadder(whatIf, LINES as never, [], "2026-11", DEFAULT_SALARY_ASSUMPTIONS);
  root.render(<CheckSalaryBox ladder={ladder} assumptions={DEFAULT_SALARY_ASSUMPTIONS} initialSalaryCents={null} />);

  const input = await whenInputAppears();
  typeInto(input, "200,000");
  // Let React finish whatever it has queued, including the mount effect.
  await new Promise((r) => setTimeout(r, 100));
  expect(host.querySelector<HTMLInputElement>("#wi-check")!.value).toBe("200,000");
  expect(host.textContent).toContain("a month to spend");
});

test("the box still follows the what-if when its salary changes", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const ladder = whatIfLadder(whatIf, LINES as never, [], "2026-11", DEFAULT_SALARY_ASSUMPTIONS);
  const draw = (cents: number | null) => root!.render(<CheckSalaryBox ladder={ladder} assumptions={DEFAULT_SALARY_ASSUMPTIONS} initialSalaryCents={cents} />);
  draw(12_000_000);
  await new Promise((r) => setTimeout(r, 50));
  expect(host.querySelector<HTMLInputElement>("#wi-check")!.value).toBe("120,000");
  draw(14_000_000); // another what-if is picked, or its salary is edited
  await new Promise((r) => setTimeout(r, 50));
  expect(host.querySelector<HTMLInputElement>("#wi-check")!.value).toBe("140,000");
});
