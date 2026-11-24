// src/domain/lifestyle-groups.ts
//
// The Lifestyle section's grouping of planning categories. Presentation only: a
// category nobody listed lands in "Other" at the end rather than disappearing.
// The household's own list is saved in settings (`lifestyle_groups`); until one
// is saved, STARTER_LIFESTYLE_GROUPS applies. Callers pass the list in.
export interface LifestyleGroup {
  id: number;
  name: string;
  categories: string[];
}

/** The groups used until the household saves its own: generic names over common US categories. */
export const STARTER_LIFESTYLE_GROUPS: LifestyleGroup[] = [
  { id: 1, name: "Housing", categories: ["Rent", "Mortgage", "Gas & Electric", "Water", "Home Improvement", "Renter's Insurance", "Furniture & Housewares", "Internet & Cable", "Phone"] },
  { id: 2, name: "Family and care", categories: ["Child Care", "Education", "Pets"] },
  { id: 3, name: "Food", categories: ["Groceries", "Restaurants & Bars", "Coffee Shops"] },
  { id: 4, name: "Transportation", categories: ["Gas", "Parking & Tolls", "Taxi & Ride Shares", "Auto Maintenance", "Auto Payment", "Public Transit"] },
  { id: 5, name: "Shopping and personal", categories: ["Shopping", "Gifts", "Electronics", "Personal", "Clothing", "Laundry", "Dry cleaning", "Returns"] },
  { id: 6, name: "Health and fitness", categories: ["Medical", "Dental", "Life Insurance", "Fitness", "Health Insurance"] },
  { id: 7, name: "Money and admin", categories: ["Financial & Legal Services", "Financial Fees", "Miscellaneous", "Cash & ATM", "Uncategorized", "Taxes"] },
  { id: 8, name: "Fun and travel", categories: ["Entertainment & Recreation", "Travel & Vacation", "One-off purchase"] },
  { id: 9, name: "Charity", categories: ["Charity"] },
];

export const OTHER_GROUP: LifestyleGroup = { id: 99, name: "Other", categories: [] };

/** The group a planning category belongs to in `groups` (the starter groups by default), or Other. */
export function groupFor(planningCategory: string, groups: LifestyleGroup[] = STARTER_LIFESTYLE_GROUPS): LifestyleGroup {
  return groups.find((g) => g.categories.includes(planningCategory)) ?? OTHER_GROUP;
}
