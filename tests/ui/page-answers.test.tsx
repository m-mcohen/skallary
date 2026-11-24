// @vitest-environment jsdom
// tests/ui/page-answers.test.tsx -- the "This page answers" line itself
// The guide-visibility store is mocked so the
// switch state is controlled directly; the wiring under test is: the right
// screen's answers line, hidden inside Help, hidden when the switch is off,
// and silent for a screen with no answers line.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

let show = true;
vi.mock("../../src/ui/lib/guide-visibility", () => ({
  useShowGuideLines: () => show,
}));

import PageAnswers from "../../src/ui/help/PageAnswers";
import { helpByKey } from "../../src/help";

afterEach(() => {
  cleanup();
  show = true;
  vi.doUnmock("../../src/help");
  vi.resetModules();
});

describe("PageAnswers", () => {
  test("shows the screen's answers line", () => {
    // Runway became Forecast; the line moved with it.
    const forecast = helpByKey("forecast")!;
    const { getByText } = render(<PageAnswers sectionId="forecast" tabId={null} />);
    expect(getByText(`This page answers: ${forecast.answers}`)).toBeTruthy();
  });

  test("a tab gets its own line, not its section's", () => {
    const charts = helpByKey("budget.charts")!;
    const table = helpByKey("budget.month")!;
    expect(charts.answers).not.toBe(table.answers);
    const { getByText, queryByText } = render(<PageAnswers sectionId="budget" tabId="charts" />);
    expect(getByText(`This page answers: ${charts.answers}`)).toBeTruthy();
    expect(queryByText(`This page answers: ${table.answers}`)).toBeNull();
  });

  test("never renders inside Help itself", () => {
    const { container } = render(<PageAnswers sectionId="help" tabId="whatif" />);
    expect(container.innerHTML).toBe("");
  });

  // In practice helpFor("help", tabId) always resolves to getting-started,
  // which has no answers line of its own -- so the test above passes even
  // without the explicit `sectionId === "help"` guard in the component. This
  // one proves the guard itself matters, by mocking helpFor to return an
  // article WITH an answers line and checking it still does not show.
  test("still hides inside Help even if the resolved article had an answers line", async () => {
    vi.doMock("../../src/help", () => ({
      helpFor: () => ({ key: "getting-started", answers: "Should never show inside Help." }),
    }));
    vi.resetModules();
    const { default: PageAnswersFresh } = await import("../../src/ui/help/PageAnswers");
    const { container } = render(<PageAnswersFresh sectionId="help" tabId="whatif" />);
    expect(container.innerHTML).toBe("");
  });

  test("renders nothing when the Settings, Guide switch is off", () => {
    show = false;
    const { container } = render(<PageAnswers sectionId="forecast" tabId={null} />);
    expect(container.innerHTML).toBe("");
  });

  test("renders nothing for a screen with no help article", () => {
    const { container } = render(<PageAnswers sectionId="no-such-screen" tabId={null} />);
    expect(container.innerHTML).toBe("");
  });
});
