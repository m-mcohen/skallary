// tests/domain/setup-progress.test.ts -- how far a household has got through the first-run
// interview, and where the interview picks up.
import { expect, test } from "vitest";
import { resumeStep, SETUP_STEPS, stillToSetUp } from "../../src/domain/setup-progress";

test("still to set up lists every step not done, skipped ones included, in interview order", () => {
  expect(stillToSetUp({ household: "done", pay: "skipped", tax: "done" }))
    .toEqual(["pay", "charity", "holidays", "banks", "accounts", "filing"]);
});

test("the interview picks up at the next unanswered step, then at a skipped one, then nowhere", () => {
  expect(resumeStep({}, SETUP_STEPS)).toBe("household");
  expect(resumeStep({ household: "done", pay: "skipped", tax: "done" }, SETUP_STEPS)).toBe("charity");
  const allAnswered = Object.fromEntries(SETUP_STEPS.map((s) => [s, s === "banks" ? "skipped" : "done"]));
  expect(resumeStep(allAnswered, SETUP_STEPS)).toBe("banks");
  expect(resumeStep(Object.fromEntries(SETUP_STEPS.map((s) => [s, "done"])), SETUP_STEPS)).toBeNull();
});
