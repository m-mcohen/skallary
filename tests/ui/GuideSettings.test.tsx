// @vitest-environment jsdom
// tests/ui/GuideSettings.test.tsx -- Settings, Guide.
// The guide-visibility store is mocked, mirroring
// page-answers.test.tsx, so the switch's own wiring is what is under test.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

let show = true;
const setShowGuideLines = vi.fn(async (_next: boolean) => {});

vi.mock("../../src/ui/lib/guide-visibility", () => ({
  useShowGuideLines: () => show,
  setShowGuideLines: (next: boolean) => setShowGuideLines(next),
}));

import GuideSettings from "../../src/ui/GuideSettings";

afterEach(() => {
  cleanup();
  show = true;
  setShowGuideLines.mockReset();
  setShowGuideLines.mockResolvedValue(undefined as never);
});

describe("GuideSettings", () => {
  test("shows the switch in the store's current state", () => {
    show = false;
    const { getByRole } = render(<GuideSettings />);
    expect(getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  test("flipping the switch calls setShowGuideLines", async () => {
    const { getByRole } = render(<GuideSettings />);
    fireEvent.click(getByRole("switch"));
    await waitFor(() => expect(setShowGuideLines).toHaveBeenCalledWith(false));
  });

  test("a save that fails shows a plain message", async () => {
    setShowGuideLines.mockRejectedValue(new Error("network down"));
    const { getByRole, findByText } = render(<GuideSettings />);
    fireEvent.click(getByRole("switch"));
    await findByText("Could not save. Try again.");
  });
});
