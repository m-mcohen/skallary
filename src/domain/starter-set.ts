// src/domain/starter-set.ts -- the starter set: a standard list of categories for a
// US household, and starter rules that file well-known national merchants into them. A new
// household picks how to start filing (choices a, b, c); nothing here is ever
// applied to a database by itself.
//
// The spending names are the starter lifestyle groups' own names, so every standard spending
// category has a group. The rules are written for national brands only: no regional chain,
// no local shop, no person.
import { STARTER_LIFESTYLE_GROUPS } from "./lifestyle-groups";

export interface StandardCategory {
  name: string;
  side: "income" | "spending" | "saving";
  /** A name the app's figures read by name: it cannot be filed elsewhere. */
  locked: boolean;
}

/**
 * Names the figures depend on: pay, the charity line (shown under the pot's own name when the
 * pot is on), the two saving names, and the two investment-income names.
 */
const LOCKED = ["Paychecks", "Charity", "Investing", "Retirement", "Interest", "Dividends"];

const INCOME = ["Paychecks", "Interest", "Dividends", "Other Income"];
const SAVING = ["Investing", "Retirement"];

export const STANDARD_CATEGORIES: readonly StandardCategory[] = [
  ...INCOME.map((name) => ({ name, side: "income" as const, locked: LOCKED.includes(name) })),
  ...STARTER_LIFESTYLE_GROUPS.flatMap((g) => g.categories).map((name) => ({ name, side: "spending" as const, locked: LOCKED.includes(name) })),
  ...SAVING.map((name) => ({ name, side: "saving" as const, locked: LOCKED.includes(name) })),
];

/** True for a standard name the figures read, ignoring case and outer spaces. */
export function isLockedCategory(name: string): boolean {
  const key = name.trim().toLowerCase();
  return LOCKED.some((n) => n.toLowerCase() === key);
}

export interface StarterRule {
  id: string;
  /** The merchant as a person reads it, for the checklist. */
  name: string;
  /** Matched as whole words against the statement text, ignoring case. */
  match: string;
  planningCategory: string;
  /**
   * A longer name containing `match` that this rule must not file (Uber leaves Uber Eats alone).
   * When the longer name's own rule is not chosen, a rule that files nothing holds its rows back.
   */
  skips?: string;
}

/**
 * In this order; a more specific name comes before a shorter one it contains (Uber Eats before
 * Uber). One merchant may have two rules for two ways statements spell it; they share a name.
 */
export const STARTER_RULES: readonly StarterRule[] = [
  // Groceries
  { id: "walmart", name: "Walmart", match: "walmart", planningCategory: "Groceries" },
  { id: "costco", name: "Costco", match: "costco", planningCategory: "Groceries" },
  { id: "whole-foods", name: "Whole Foods Market", match: "whole foods", planningCategory: "Groceries" },
  { id: "trader-joes", name: "Trader Joe's", match: "trader joe", planningCategory: "Groceries" },
  { id: "aldi", name: "Aldi", match: "aldi", planningCategory: "Groceries" },
  { id: "instacart", name: "Instacart", match: "instacart", planningCategory: "Groceries" },
  // Coffee shops
  { id: "starbucks", name: "Starbucks", match: "starbucks", planningCategory: "Coffee Shops" },
  { id: "dunkin", name: "Dunkin'", match: "dunkin", planningCategory: "Coffee Shops" },
  // Restaurants and delivery
  { id: "uber-eats", name: "Uber Eats", match: "uber eats", planningCategory: "Restaurants & Bars" },
  { id: "doordash", name: "DoorDash", match: "doordash", planningCategory: "Restaurants & Bars" },
  { id: "grubhub", name: "Grubhub", match: "grubhub", planningCategory: "Restaurants & Bars" },
  { id: "mcdonalds", name: "McDonald's", match: "mcdonald's", planningCategory: "Restaurants & Bars" },
  { id: "chipotle", name: "Chipotle", match: "chipotle", planningCategory: "Restaurants & Bars" },
  { id: "subway", name: "Subway", match: "subway", planningCategory: "Restaurants & Bars" },
  { id: "taco-bell", name: "Taco Bell", match: "taco bell", planningCategory: "Restaurants & Bars" },
  { id: "burger-king", name: "Burger King", match: "burger king", planningCategory: "Restaurants & Bars" },
  { id: "chick-fil-a", name: "Chick-fil-A", match: "chick-fil-a", planningCategory: "Restaurants & Bars" },
  { id: "pizza-hut", name: "Pizza Hut", match: "pizza hut", planningCategory: "Restaurants & Bars" },
  { id: "panera", name: "Panera Bread", match: "panera", planningCategory: "Restaurants & Bars" },
  // Rides
  { id: "uber", name: "Uber", match: "uber", planningCategory: "Taxi & Ride Shares", skips: "uber eats" },
  { id: "lyft", name: "Lyft", match: "lyft", planningCategory: "Taxi & Ride Shares" },
  // Fuel
  { id: "shell", name: "Shell", match: "shell", planningCategory: "Gas" },
  { id: "chevron", name: "Chevron", match: "chevron", planningCategory: "Gas" },
  { id: "exxonmobil", name: "ExxonMobil", match: "exxonmobil", planningCategory: "Gas" },
  { id: "bp", name: "BP", match: "bp", planningCategory: "Gas" },
  // Car care
  { id: "jiffy-lube", name: "Jiffy Lube", match: "jiffy lube", planningCategory: "Auto Maintenance" },
  { id: "autozone", name: "AutoZone", match: "autozone", planningCategory: "Auto Maintenance" },
  // Shopping
  { id: "amazon", name: "Amazon", match: "amazon", planningCategory: "Shopping" },
  { id: "amzn", name: "Amazon", match: "amzn", planningCategory: "Shopping" },
  { id: "target", name: "Target", match: "target", planningCategory: "Shopping" },
  { id: "ebay", name: "eBay", match: "ebay", planningCategory: "Shopping" },
  { id: "etsy", name: "Etsy", match: "etsy", planningCategory: "Shopping" },
  { id: "best-buy", name: "Best Buy", match: "best buy", planningCategory: "Electronics" },
  { id: "home-depot", name: "The Home Depot", match: "home depot", planningCategory: "Home Improvement" },
  { id: "lowes", name: "Lowe's", match: "lowes", planningCategory: "Home Improvement" },
  { id: "ikea", name: "IKEA", match: "ikea", planningCategory: "Furniture & Housewares" },
  { id: "wayfair", name: "Wayfair", match: "wayfair", planningCategory: "Furniture & Housewares" },
  { id: "tj-maxx", name: "TJ Maxx", match: "tj maxx", planningCategory: "Clothing" },
  { id: "old-navy", name: "Old Navy", match: "old navy", planningCategory: "Clothing" },
  { id: "macys", name: "Macy's", match: "macy's", planningCategory: "Clothing" },
  { id: "nike", name: "Nike", match: "nike", planningCategory: "Clothing" },
  // Streaming and outings
  { id: "netflix", name: "Netflix", match: "netflix", planningCategory: "Entertainment & Recreation" },
  { id: "spotify", name: "Spotify", match: "spotify", planningCategory: "Entertainment & Recreation" },
  { id: "hulu", name: "Hulu", match: "hulu", planningCategory: "Entertainment & Recreation" },
  { id: "disney-plus", name: "Disney+", match: "disney+", planningCategory: "Entertainment & Recreation" },
  { id: "amc-theatres", name: "AMC Theatres", match: "amc", planningCategory: "Entertainment & Recreation" },
  { id: "ticketmaster", name: "Ticketmaster", match: "ticketmaster", planningCategory: "Entertainment & Recreation" },
  // Phone, internet and cable
  { id: "verizon", name: "Verizon", match: "verizon", planningCategory: "Phone" },
  { id: "att", name: "AT&T", match: "at&t", planningCategory: "Phone" },
  { id: "t-mobile", name: "T-Mobile", match: "t-mobile", planningCategory: "Phone" },
  { id: "comcast", name: "Comcast", match: "comcast", planningCategory: "Internet & Cable" },
  { id: "xfinity", name: "Xfinity", match: "xfinity", planningCategory: "Internet & Cable" },
  { id: "spectrum", name: "Spectrum", match: "spectrum", planningCategory: "Internet & Cable" },
  // Health and fitness
  { id: "cvs", name: "CVS", match: "cvs", planningCategory: "Medical" },
  { id: "walgreens", name: "Walgreens", match: "walgreens", planningCategory: "Medical" },
  { id: "planet-fitness", name: "Planet Fitness", match: "planet fitness", planningCategory: "Fitness" },
  { id: "peloton", name: "Peloton", match: "peloton", planningCategory: "Fitness" },
  // Pets
  { id: "petco", name: "Petco", match: "petco", planningCategory: "Pets" },
  { id: "petsmart", name: "PetSmart", match: "petsmart", planningCategory: "Pets" },
  { id: "chewy", name: "Chewy", match: "chewy", planningCategory: "Pets" },
  // Travel
  { id: "delta", name: "Delta Air Lines", match: "delta air", planningCategory: "Travel & Vacation" },
  { id: "united-airlines", name: "United Airlines", match: "united airlines", planningCategory: "Travel & Vacation" },
  { id: "american-airlines", name: "American Airlines", match: "american airlines", planningCategory: "Travel & Vacation" },
  { id: "southwest-airlines", name: "Southwest Airlines", match: "southwest airlines", planningCategory: "Travel & Vacation" },
  { id: "airbnb", name: "Airbnb", match: "airbnb", planningCategory: "Travel & Vacation" },
  { id: "marriott", name: "Marriott", match: "marriott", planningCategory: "Travel & Vacation" },
  { id: "hilton", name: "Hilton", match: "hilton", planningCategory: "Travel & Vacation" },
  { id: "expedia", name: "Expedia", match: "expedia", planningCategory: "Travel & Vacation" },
];

/** Starter rules sit below every learned (500) and hand-written (100) rule, so the household's own win. */
export const STARTER_RULE_PRIORITY = 900;

/** The note a starter rule carries, so a list of rules can say where it came from. */
export function starterRuleNote(rule: StarterRule): string {
  return `Starter rule: ${rule.id}`;
}
