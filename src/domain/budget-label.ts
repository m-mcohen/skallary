// src/domain/budget-label.ts -- how a budget is named on screen: by its
// year. The stored name ("2026 Plan") and id ("plan-2026") never reach the screen.
export function budgetLabel(plan: { startDate: string }): string {
  return `Budget: ${plan.startDate.slice(0, 4)}`;
}
