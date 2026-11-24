// @vitest-environment jsdom
// tests/ui/info-point-target.test.tsx
//
// The i points measured 22 px; 24 px is the usual minimum
// click target. The icon stays its size; the button around it grows.
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import InfoPoint from "../../src/ui/help/InfoPoint";

afterEach(cleanup);

test("an info point's button is at least 24 px square", () => {
  render(<InfoPoint termId="drawable" />);
  const button = screen.getByRole("button", { name: "About Drawable" });
  expect(button.className).toMatch(/min-h-6/);
  expect(button.className).toMatch(/min-w-6/);
});
