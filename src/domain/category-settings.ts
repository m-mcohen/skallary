// src/domain/category-settings.ts
//
// Per-planning-category settings that live alongside (not inside) budget
// lines: whether a category is a recurring fixed bill vs variable spend,
// and whether the user has hand-set its default amount so the seed must
// never overwrite it. See migrations/0011_category_settings.sql.
export interface CategorySetting {
  planningCategory: string;
  recurring: boolean | null; // null = auto (seed decides); true/false = derived or user-set
  recurringSource: "auto" | "user" | null; // null = never set (recurring is also null)
  pinned: boolean; // true = user hand-set the default amount; seed must not overwrite it
}
