// tests/ui/goal-api-errors.test.ts
// The goal dialog and the Start this cost
// confirmation show the server's own plain words, never "API /goals failed: 400".
import { afterEach, describe, expect, test, vi } from "vitest";
import { setGoalStateUI, upsertGoalUI } from "../../src/ui/lib/db";
import type { Goal } from "../../src/domain/plan-types";

const refuse = (status: number, error: string) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status, json: async () => ({ ok: false, error }) }) as unknown as Response));

afterEach(() => vi.unstubAllGlobals());

describe("goal saves surface the server's words", () => {
  test("saving a goal", async () => {
    refuse(400, "Ongoing cost a month cannot be negative.");
    await expect(upsertGoalUI({ base: "" }, { id: "g" } as Goal)).rejects.toThrow("Ongoing cost a month cannot be negative.");
  });

  test("starting a cost or marking complete", async () => {
    refuse(400, "There is already a budget line called Fitness. Pick it under Add to an existing line, or choose another name.");
    await expect(setGoalStateUI({ base: "" }, "ma", { startCost: { planId: "p", line: "Fitness", mode: "new" } })).rejects.toThrow(
      "There is already a budget line called Fitness."
    );
  });

  test("a success resolves, and the request goes to the goal's own state route", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }) as unknown as Response);
    vi.stubGlobal("fetch", fetchSpy);
    await setGoalStateUI({ base: "" }, "ma", { completed: true });
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe("/api/goals/ma/state");
  });
});
