// src/domain/notes-types.ts
//
// App-owned persistence DTOs for the BUDGET_LOG.md
// state migration: locked decisions / spend trims / notes, point-in-time
// drawable+burn snapshots, and data-quality flags. See
// migrations/0007_budget_log_state.sql for the table shapes these mirror
// for the migration design.

export interface BudgetNote {
  id: string;
  planId: string;
  kind: "decision" | "trim" | "note";
  text: string;
  status: string | null; // e.g. 'locked' | 'committed' | 'pending' | null
  monthlyCents: number | null; // for trims; null otherwise
  createdAt: string; // ISO timestamp
}

export interface SnapshotHistoryEntry {
  id: string;
  planId: string;
  asOf: string;
  drawableCents: number | null;
  burn3moCents: number | null;
  burn12moCents: number | null;
  note: string | null;
  createdAt: string; // ISO timestamp
}

export interface DataQualityFlag {
  id: string;
  planId: string;
  label: string;
  detail: string | null;
  status: "open" | "resolved";
  resolution: string | null;
  createdAt: string; // ISO timestamp
}
