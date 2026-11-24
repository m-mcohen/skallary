// src/ui/lib/grid-theme.ts
//
// One AG Grid theme for the whole app.
//
// Quartz parameterized with the app's CSS variables, so a grid reads as part of
// the same design system instead of stock AG Grid blue -- and so recolouring the
// app recolours its grids, since every value here resolves through a token
// rather than a literal.
//
// Lifted out of BudgetGrid when the Transactions grid needed the same look: two
// copies of a theme drift, and a grid that drifts is exactly the "looks like a
// different application" problem this rework exists to fix.
import { themeQuartz } from "ag-grid-community";

export const financeGridTheme = themeQuartz.withParams({
  backgroundColor: "var(--card)",
  foregroundColor: "var(--foreground)",
  headerBackgroundColor: "var(--muted)",
  headerTextColor: "var(--muted-foreground)",
  headerFontWeight: 600,
  borderColor: "var(--border)",
  rowHoverColor: "var(--accent)",
  accentColor: "var(--primary)",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  spacing: 6,
  wrapperBorderRadius: "var(--radius-lg)",
});
