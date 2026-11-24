// tests/ui/recurring-fetchers.test.ts
//
// The three calls behind Not recurring, Mark as recurring and Show again
// The read survives the route not existing yet; a refused
// save carries the server's own words, which the dialog shows.
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteRecurringChoiceUI, getRecurringChoicesUI, saveRecurringChoiceUI, type Db } from "../../src/ui/lib/db";

const db: Db = { base: "/api" };

function respond(status: number, body?: unknown) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;
}
const calls = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls;

afterEach(() => vi.unstubAllGlobals());

const choice = { payeeKey: "example insurance", accountId: "acct-0303", choice: "recurring" as const, cadence: "monthly" as const, label: "Example Insurance" };

describe("recurring choices", () => {
  it("reads GET /api/recurring-choices, and a 404 as none", async () => {
    const f = respond(200, [{ ...choice, createdAt: "2026-03-01T12:00:00.000Z" }]);
    vi.stubGlobal("fetch", f);
    expect(await getRecurringChoicesUI(db)).toHaveLength(1);
    expect(calls(f)[0][0]).toBe("/api/recurring-choices");
    vi.stubGlobal("fetch", respond(404));
    expect(await getRecurringChoicesUI(db)).toEqual([]);
  });

  it("saves with PUT and the choice as the body", async () => {
    const f = respond(204);
    vi.stubGlobal("fetch", f);
    await saveRecurringChoiceUI(db, choice);
    expect(calls(f)[0][0]).toBe("/api/recurring-choices");
    expect(calls(f)[0][1].method).toBe("PUT");
    expect(JSON.parse(calls(f)[0][1].body)).toEqual(choice);
  });

  it("a refused save throws the server's words", async () => {
    vi.stubGlobal("fetch", respond(400, { ok: false, error: "Pick how often it repeats." }));
    await expect(saveRecurringChoiceUI(db, choice)).rejects.toThrow("Pick how often it repeats.");
  });

  it("Show again deletes by merchant key and account, encoded", async () => {
    const f = respond(204);
    vi.stubGlobal("fetch", f);
    await deleteRecurringChoiceUI(db, "netflix & co", "acct 1");
    expect(calls(f)[0][0]).toBe("/api/recurring-choices?payeeKey=netflix+%26+co&accountId=acct+1");
    expect(calls(f)[0][1].method).toBe("DELETE");
  });
});
