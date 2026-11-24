// server/services/mortgageRateService.ts
//
// Today's mortgage rate for the goal payment helper:
// Freddie Mac's Primary Mortgage Market Survey, the weekly average for 30-year
// and 15-year fixed loans, read from the St. Louis Fed's free FRED service (no
// account, no key). Public data only; nothing of the user's is sent. Asked at
// most once a day: the survey itself changes once a week.

export interface WeeklyRate { ratePct: number; weekOf: string }
export interface MortgageRates { thirtyYear: WeeklyRate; fifteenYear: WeeklyRate }

const FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=";
const DAY_MS = 86_400_000;
const REFUSAL = "Could not get today's rate; type one.";
/** How long to wait before giving up. */
export const RATE_TIMEOUT_MS = 5000;

let cache: { at: number; rates: MortgageRates } | null = null;

/** Tests only. */
export function clearMortgageRateCache(): void {
  cache = null;
}

/** The latest filled-in week of a FRED series CSV, or null. FRED writes "." for a week not yet published. */
export function parseFredCsv(csv: string): WeeklyRate | null {
  const rows = csv.trim().split(/\r?\n/).slice(1).reverse();
  for (const row of rows) {
    const [weekOf, value] = row.split(",");
    const ratePct = Number(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(weekOf ?? "") && value !== "." && Number.isFinite(ratePct)) return { ratePct, weekOf };
  }
  return null;
}

async function series(id: string, fetchFn: typeof fetch, timeoutMs: number): Promise<WeeklyRate> {
  // The request is told to stop, and the wait is cut off anyway in case it ignores that.
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stop.abort();
      reject(new Error(REFUSAL));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const res = await fetchFn(`${FRED}${id}`, { signal: stop.signal });
        if (!res.ok) throw new Error(REFUSAL);
        const rate = parseFredCsv(await res.text());
        if (!rate) throw new Error(REFUSAL);
        return rate;
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getMortgageRates(fetchFn: typeof fetch = fetch, now: () => number = Date.now, timeoutMs: number = RATE_TIMEOUT_MS): Promise<MortgageRates> {
  const t = now();
  if (cache && t - cache.at < DAY_MS) return cache.rates;
  try {
    const [thirtyYear, fifteenYear] = await Promise.all([series("MORTGAGE30US", fetchFn, timeoutMs), series("MORTGAGE15US", fetchFn, timeoutMs)]);
    cache = { at: t, rates: { thirtyYear, fifteenYear } };
    return cache.rates;
  } catch {
    throw new Error(REFUSAL);
  }
}
