// tests/server/mortgage-rates.test.ts
// Freddie Mac's weekly
// average via FRED, prefilled and always editable, asked at most once a day.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { clearMortgageRateCache, getMortgageRates, parseFredCsv, RATE_TIMEOUT_MS } from "../../server/services/mortgageRateService";

const csv = (rows: string) => `observation_date,MORTGAGE30US\n${rows}\n`;
const stub = (bodies: Record<string, string>, ok = true) => {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const id = new URL(url).searchParams.get("id")!;
    return { ok, status: ok ? 200 : 503, text: async () => bodies[id] ?? "" } as unknown as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
};
const DAY = 86_400_000;

beforeEach(() => clearMortgageRateCache());

describe("parseFredCsv", () => {
  test("reads the latest week", () => {
    expect(parseFredCsv(csv("2026-09-17,7.10\n2026-09-24,7.03"))).toEqual({ ratePct: 7.03, weekOf: "2026-09-24" });
  });
  test("skips a latest row FRED has not filled in yet ('.')", () => {
    expect(parseFredCsv(csv("2026-09-17,7.10\n2026-09-24,."))).toEqual({ ratePct: 7.1, weekOf: "2026-09-17" });
  });
  test("an empty or broken file is no rate at all", () => {
    expect(parseFredCsv("")).toBeNull();
    expect(parseFredCsv("<html>error</html>")).toBeNull();
  });
});

describe("getMortgageRates", () => {
  const bodies = { MORTGAGE30US: csv("2026-09-24,7.03"), MORTGAGE15US: csv("2026-09-24,6.42") };

  test("30-year and 15-year, from FRED", async () => {
    const { fn, calls } = stub(bodies);
    expect(await getMortgageRates(fn, () => 0)).toEqual({
      thirtyYear: { ratePct: 7.03, weekOf: "2026-09-24" },
      fifteenYear: { ratePct: 6.42, weekOf: "2026-09-24" },
    });
    expect(calls.every((u) => u.startsWith("https://fred.stlouisfed.org/graph/fredgraph.csv?id="))).toBe(true);
  });

  test("asks at most once a day", async () => {
    const { fn, calls } = stub(bodies);
    await getMortgageRates(fn, () => 0);
    await getMortgageRates(fn, () => DAY - 1);
    expect(calls).toHaveLength(2);
    await getMortgageRates(fn, () => DAY + 1);
    expect(calls).toHaveLength(4);
  });

  test("FRED down is a plain-words refusal, and nothing is cached", async () => {
    const down = stub(bodies, false);
    await expect(getMortgageRates(down.fn, () => 0)).rejects.toThrow("Could not get today's rate; type one.");
    const up = stub(bodies);
    await getMortgageRates(up.fn, () => 1);
    expect(up.calls).toHaveLength(2);
  });

  // give up after 5 seconds with the plain refusal.
  test("a hung request gives up and says so, and nothing is cached", async () => {
    const hung = (async () => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const started = Date.now();
    await expect(getMortgageRates(hung, () => 0, 30)).rejects.toThrow("Could not get today's rate; type one.");
    expect(Date.now() - started).toBeLessThan(2000);
    const up = stub(bodies);
    await getMortgageRates(up.fn, () => 1);
    expect(up.calls).toHaveLength(2);
  });

  // The request itself is stopped at the deadline, not left running.
  test("at the default 5-second deadline the pending request is aborted and the refusal is raised; a second before, neither", async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const pending = (async (_url: string, init?: RequestInit) => {
        signals.push(init!.signal as AbortSignal);
        return new Promise<Response>(() => {}); // never answers
      }) as unknown as typeof fetch;
      const outcome = getMortgageRates(pending, () => 0).then(() => "answered", (e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(RATE_TIMEOUT_MS - 1);
      expect(signals).toHaveLength(2); // the 30-year and 15-year lookups
      expect(signals.every((s) => !s.aborted)).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(signals.every((s) => s.aborted)).toBe(true);
      expect(await outcome).toBe("Could not get today's rate; type one.");
      expect(RATE_TIMEOUT_MS).toBe(5000);
    } finally {
      vi.useRealTimers();
    }
  });
});
