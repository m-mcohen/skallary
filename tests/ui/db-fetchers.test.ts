// tests/ui/db-fetchers.test.ts
//
// The two reads added for the seed nudge and the trailing readout. Both must
// survive the endpoint not existing yet: the UI ships ahead of the server,
// and a 404 has to read as "nothing known" rather than take the head down.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCategoryUI, getSeedStatusUI, getShowGuideLinesUI, getTrailingUI, setShowGuideLinesUI, type Db } from "../../src/ui/lib/db";

const db: Db = { base: "/api" };

function respond(status: number, body?: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("getSeedStatusUI", () => {
  it("reads GET /api/settings/seed", async () => {
    const f = respond(200, { lastSeedAt: "2026-09-02T18:07:00.000Z", windowMonths: 12, reseedDueAt: "2026-12-01", reseedDue: false });
    vi.stubGlobal("fetch", f);
    const s = await getSeedStatusUI(db);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/settings/seed");
    expect(s).toEqual({ lastSeedAt: "2026-09-02T18:07:00.000Z", windowMonths: 12, reseedDueAt: "2026-12-01", reseedDue: false });
  });

  it("reads a 404 as never seeded and not due, so no nudge fires before the server lands", async () => {
    vi.stubGlobal("fetch", respond(404));
    expect(await getSeedStatusUI(db)).toEqual({ lastSeedAt: null, windowMonths: null, reseedDueAt: null, reseedDue: false });
  });

  it("still throws on a real failure", async () => {
    vi.stubGlobal("fetch", respond(500));
    await expect(getSeedStatusUI(db)).rejects.toThrow();
  });
});

describe("getTrailingUI", () => {
  it("reads GET /api/trailing?months=12 with no plan in the path, so the figure exists before a plan is picked", async () => {
    const f = respond(200, { months: 12, window: ["2025-09"], totalCents: 8_400_000, monthlyAverageCents: 700_000 });
    vi.stubGlobal("fetch", f);
    const t = await getTrailingUI(db);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/trailing?months=12");
    expect(t.monthlyAverageCents).toBe(700_000);
  });

  it("reads a 404 as zero", async () => {
    vi.stubGlobal("fetch", respond(404));
    expect(await getTrailingUI(db, 6)).toEqual({ months: 6, window: [], totalCents: 0, monthlyAverageCents: 0 });
  });
});

describe("getShowGuideLinesUI / setShowGuideLinesUI (the guide line switch)", () => {
  it("reads GET /api/settings/guide", async () => {
    const f = respond(200, { show: false });
    vi.stubGlobal("fetch", f);
    expect(await getShowGuideLinesUI(db)).toBe(false);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/settings/guide");
  });

  it("reads a 404 as shown, so the line is not hidden before the server lands", async () => {
    vi.stubGlobal("fetch", respond(404));
    expect(await getShowGuideLinesUI(db)).toBe(true);
  });

  it("writes POST /api/settings/guide", async () => {
    const f = respond(204);
    vi.stubGlobal("fetch", f);
    await setShowGuideLinesUI(db, false);
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/api/settings/guide");
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ show: false });
  });
});

describe("createCategoryUI", () => {
  const routed = (mappings: Record<string, string>) => {
    const calls: { url: string; method: string; body: string | null }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: (init?.body as string) ?? null });
      if (url === "/api/category-mappings" && (init?.method ?? "GET") === "GET") {
        return { ok: true, status: 200, json: async () => mappings } as Response;
      }
      return { ok: true, status: 204, json: async () => undefined } as Response;
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", f);
    return calls;
  };

  it("records a new name as an identity mapping", async () => {
    const calls = routed({ "Coffee Shops": "Dining Out" });
    await createCategoryUI(db, "  Kids ");
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/category-mappings");
    expect(JSON.parse(post!.body!)).toEqual({ source: "Kids", planning: "Kids" });
  });

  it("refuses a name that is an incoming category already filed elsewhere, and says where to change it", async () => {
    const calls = routed({ "Coffee Shops": "Dining Out" });
    await expect(createCategoryUI(db, "Coffee Shops")).rejects.toThrow(/filed under Dining Out.*Settings, Mappings/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("refuses the same incoming category in another case or with spaces around it", async () => {
    const calls = routed({ "coffee shops": "Dining Out" });
    await expect(createCategoryUI(db, " Coffee Shops ")).rejects.toThrow(/filed under Dining Out/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("is a no-op for a name that already exists, and refuses a blank one", async () => {
    const calls = routed({ Kids: "Kids" });
    await createCategoryUI(db, "Kids");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    await expect(createCategoryUI(db, "   ")).rejects.toThrow(/needs a name/);
  });
});
