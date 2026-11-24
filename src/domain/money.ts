export type Cents = number;

export function parseDollarsToCents(input: string): Cents {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error(`Not a money value: ${input}`);
  const neg = cleaned.startsWith("-");
  const [whole, frac = ""] = cleaned.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return neg ? -cents : cents;
}

export function formatCents(c: Cents): string {
  const neg = c < 0;
  const abs = Math.abs(c);
  const dollars = (abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg ? "-" : ""}$${dollars}`;
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}

/** Rounded to the nearest whole dollar -- a figure to plan around, not a ledger entry. */
export function formatWholeDollars(c: Cents): string {
  const dollars = Math.round(c / 100);
  const neg = dollars < 0;
  const abs = Math.abs(dollars).toLocaleString("en-US");
  return `${neg ? "-" : ""}$${abs}`;
}

/**
 * Short, sign first, no cents: an axis label ("-$50K", "$1.3M", "$800"). Audit
 * Full figures with cents were clipped by the axis width, so a
 * below-zero label read "$50,000.00".
 */
export function formatAxisDollars(c: Cents): string {
  const dollars = Math.round(c / 100);
  const sign = dollars < 0 ? "-" : "";
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `${sign}$${Number((abs / 1_000_000).toFixed(1))}M`;
  if (abs >= 1000) return `${sign}$${abs >= 10_000 ? Math.round(abs / 1000) : Number((abs / 1000).toFixed(1))}K`;
  return `${sign}$${abs}`;
}

/**
 * For a box that is read on every keystroke: whatever is typed becomes cents,
 * and anything unreadable (or negative) is 0 rather than an exception. Commas,
 * a dollar sign and spaces are fine. parseDollarsToCents stays the strict one
 * for values that are about to be saved.
 */
export function parseLooseDollarsToCents(input: string): Cents {
  try {
    const cents = parseDollarsToCents(input);
    return cents > 0 ? cents : 0;
  } catch {
    return 0;
  }
}

/**
 * A stored rate (0.035) as the text for a percent box ("3.5"). Plain
 * String(0.035 * 100) gives "3.5000000000000004"; rounding to four decimals
 * first gives back the number that was typed.
 */
export function percentInputValue(rate: number): string {
  return String(Number((rate * 100).toFixed(4)));
}
