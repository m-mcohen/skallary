// src/domain/account-display.ts -- how accounts, snapshot dates and old notes read on
// screen. Display only: stored names and values are never changed here.
import { formatDateRange, localDateIso } from "./period";
import type { Household } from "./household";

/** The types the server accepts; kept in step with connectorService.ACCOUNT_TYPES. */
export const ACCOUNT_TYPES = [
  { value: "depository", label: "Cash" },
  { value: "credit", label: "Card" },
  { value: "brokerage", label: "Brokerage" },
  { value: "retirement", label: "Retirement" },
  { value: "loan", label: "Loan" },
] as const;

export function accountTypeLabel(type: string | null): string {
  if (!type) return "No type";
  return ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? type;
}

const JOINT_PREFIX = /^Joint w\/Survivor\s+/i;
const titleWord = (w: string) => (w.length <= 2 ? w : w[0] + w.slice(1).toLowerCase());
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The names a bank may put in front of an account name: the household's own, as stored. */
export function householdPeople(h: Household | null): string[] {
  return h ? [h.youName, h.partnerName].filter((n): n is string => !!n && n.trim() !== "") : [];
}

// The household's names, remembered once the app has read them (rememberHouseholdPeople), so
// every screen that shows an account name strips them without each one loading the household.
let rememberedPeople: string[] = [];

export function rememberHouseholdPeople(h: Household | null): void {
  rememberedPeople = householdPeople(h);
}

/**
 * The short name every list shows: a household member's name at the front dropped (matched
 * whole as stored, in any case; two names read "Joint"), "NFS" and doubled spaces
 * dropped, the doubled bracket the bank sends ("(123))") fixed, and a name written all in
 * capitals title-cased, keeping two-letter words such as "MC". Anything else stays as the
 * bank wrote it. `people` are the household's names (householdPeople), by default the
 * remembered ones; a name stored as the bank writes it (with the family name) drops whole.
 */
export function displayAccountName(name: string, people: readonly string[] = rememberedPeople): string {
  let n = name.replace(/\)\)/g, ")").replace(/\bNFS\b/g, "").replace(/\s+/g, " ").trim();
  const prefixes = people.map((p) => new RegExp(`^${escapeRegExp(p.trim())}(?=$|[\\s,&-])`, "i"));
  let owners = 0;
  for (let found = true; found; ) {
    found = false;
    for (const prefix of prefixes) {
      const m = prefix.exec(n);
      if (!m) continue;
      const rest = n.slice(m[0].length).replace(/^[\s,&-]+/, "");
      if (!/[a-z]/i.test(rest)) continue; // the name is all there is: keep it
      n = rest;
      owners++;
      found = true;
    }
  }
  let joint = owners >= 2;
  if (JOINT_PREFIX.test(n)) {
    n = n.replace(JOINT_PREFIX, "");
    joint = true;
  }
  if (!/[a-z]/.test(n)) n = n.split(" ").map(titleWord).join(" ");
  return joint && !/^Joint\b/.test(n) ? `Joint ${n}` : n;
}

/** A date or a UTC timestamp, as the local calendar date: "Sep 21, 2026". */
export function formatSnapshotDate(asOf: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return formatDateRange(asOf, asOf);
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return asOf;
  const local = localDateIso(d);
  return formatDateRange(local, local);
}

/** A flag's resolution as stored: the text is written in plain words where it is saved. */
export function plainFlagResolution(_id: string, stored: string | null): string | null {
  return stored;
}

/** The two notes the app writes itself, in plain words; a note typed by hand is kept as written. */
export function plainSnapshotNote(note: string | null): string {
  if (note === "auto (post-sync)") return "After a sync";
  if (note?.startsWith("Ported from BUDGET_LOG")) return "Starting point, before the app";
  return note ?? "";
}
