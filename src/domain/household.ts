// src/domain/household.ts -- who the household is: the person using the app, an optional
// partner, and the three owner slots an account can belong to.
export type OwnerSlot = "me" | "partner" | "joint";
export interface Household { youName: string; partnerName: string | null }

export const OWNER_SLOTS: readonly OwnerSlot[] = ["me", "partner", "joint"];

/** The app_settings key that holds the household's names. */
export const HOUSEHOLD_KEY = "household";
/** The app_settings key for "count the partner's own accounts": "true" or "false". */
export const INCLUDE_PARTNER_KEY = "include_partner_accounts";

/**
 * The owner slot of a stored owner code. The three slots pass; no code reads as the person
 * using the app; any other code (one written before the slots were renamed) reads as the
 * partner, so the partner's accounts keep following the include switch.
 */
export function toOwnerSlot(raw: string | null): OwnerSlot {
  if (raw === null) return "me";
  return isOwnerSlot(raw) ? raw : "partner";
}

export function isOwnerSlot(v: unknown): v is OwnerSlot {
  return typeof v === "string" && (OWNER_SLOTS as readonly string[]).includes(v);
}

/** How an owner slot reads on screen. */
export function ownerLabel(slot: OwnerSlot, h: Household | null): string {
  if (slot === "me") return h?.youName ?? "You";
  if (slot === "partner") return h?.partnerName ?? "";
  return "Shared";
}

/** The stored include setting: nothing saved means the partner's accounts count. */
export function includePartnerFromSetting(raw: string | null): boolean {
  return raw === null || raw === "true";
}

const MAX_NAME = 40;

/** A household from untrusted input, or a plain message saying what is wrong. */
export function cleanHousehold(raw: unknown): Household | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "Type your first name.";
  const { youName, partnerName } = raw as Record<string, unknown>;
  if (typeof youName !== "string" || youName.trim() === "") return "Type your first name.";
  if (partnerName !== null && partnerName !== undefined && typeof partnerName !== "string") {
    return "Your partner's name is a name, or blank for none.";
  }
  const you = youName.trim();
  const partner = typeof partnerName === "string" && partnerName.trim() !== "" ? partnerName.trim() : null;
  if (you.length > MAX_NAME || (partner?.length ?? 0) > MAX_NAME) return `A name is at most ${MAX_NAME} characters.`;
  return { youName: you, partnerName: partner };
}

/** The stored household, or null when nothing usable is saved. */
export function householdFromSetting(raw: string | null): Household | null {
  if (raw === null) return null;
  try {
    const h = cleanHousehold(JSON.parse(raw));
    return typeof h === "string" ? null : h;
  } catch {
    return null;
  }
}
