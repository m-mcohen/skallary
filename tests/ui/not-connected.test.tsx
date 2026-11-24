// @vitest-environment jsdom
// tests/ui/not-connected.test.tsx
//
// When the local server cannot be reached, the shell's
// "Not connected" banner says why the screen is empty. The Dashboard and the
// top bar used to keep their gray loading blocks under it forever, and What if
// added "Pick a budget first.", the wrong advice when the server is down.
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DashboardSection from "../../src/ui/DashboardSection";
import EquationBar from "../../src/ui/shell/EquationBar";
import WhatIfSection from "../../src/ui/what-if/WhatIfSection";

afterEach(cleanup);

test("the Dashboard shows no endless loading blocks when not connected", () => {
  const { container } = render(<DashboardSection summary={null} planId={null} onChanged={() => {}} unavailable />);
  expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
});

test("the Dashboard still shows loading blocks while it is only loading", () => {
  const { container } = render(<DashboardSection summary={null} planId={null} onChanged={() => {}} />);
  expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
});

test("the top bar shows no loading block when not connected", () => {
  render(<EquationBar equation={null} unavailable />);
  expect(screen.queryByTestId("equation-loading")).toBeNull();
});

test("What if does not say Pick a budget first when not connected", () => {
  render(<WhatIfSection planId={null} unavailable />);
  expect(screen.queryByText("Pick a budget first.")).toBeNull();
});
