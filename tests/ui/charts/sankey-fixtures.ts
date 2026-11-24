// An invented flow for the Sankey tests: pay of 5000 in, rent 2000, groceries 750, saving 500,
// 1750 left over (all in cents). Not from any real figures.
import type { PayFlow } from "../../../src/domain/sankey";
import type { Palette } from "../../../src/ui/charts/looks";

export const PALETTE: Palette = {
  ink: "#111", ink2: "#666", line: "#ddd", grid: "#eee", card: "#fff", blue: "#00f", red: "#f00", green: "#0a0",
  flow: "#ccc", categorical: ["#1", "#2", "#3", "#4", "#5", "#6", "#7", "#8"],
};

export function invention(): PayFlow {
  return {
    from: "2026-10", to: "2026-10", showsPaycheck: false,
    nodes: [
      { id: "in:Paychecks", label: "Paychecks", kind: "bank", modelled: false },
      { id: "bank", label: "Money in", kind: "bank", modelled: false },
      { id: "cat:Rent", label: "Rent", kind: "category", modelled: false },
      { id: "cat:Groceries", label: "Groceries", kind: "category", modelled: false },
      { id: "saving", label: "Saving", kind: "saving", modelled: false },
      { id: "left-over", label: "Left over", kind: "left-over", modelled: false },
    ],
    links: [
      { from: "in:Paychecks", to: "bank", cents: 500000, modelled: false },
      { from: "bank", to: "cat:Rent", cents: 200000, modelled: false },
      { from: "bank", to: "cat:Groceries", cents: 75000, modelled: false },
      { from: "bank", to: "saving", cents: 50000, modelled: false },
      { from: "bank", to: "left-over", cents: 175000, modelled: false },
    ],
  };
}
