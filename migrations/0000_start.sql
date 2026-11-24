-- Starting structure for a new finance database.

CREATE TABLE IF NOT EXISTS account_balance_readings (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recorded_on TEXT NOT NULL,
  balance_cents INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  PRIMARY KEY (account_id, recorded_on)
);

CREATE TABLE IF NOT EXISTS account_balances (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  balance_cents INTEGER NOT NULL,
  as_of TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  institution TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_owned INTEGER NOT NULL DEFAULT 1,
  include_in_spend INTEGER NOT NULL DEFAULT 1,
  owner TEXT NOT NULL DEFAULT 'me',
  type_source TEXT NOT NULL DEFAULT 'feed',
  conn_id TEXT,
  balance_cents INTEGER,
  available_balance_cents INTEGER,
  balance_date TEXT,
  drawable INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  savings_destination TEXT,
  maaser_pot INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_big_months (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  planning_category TEXT NOT NULL,
  month TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  planning_category TEXT NOT NULL,
  from_month TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('changed', 'goal')),
  goal_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  planning_category TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'suggested',
  UNIQUE(plan_id, planning_category, period)
);

CREATE TABLE IF NOT EXISTS budget_month_notes (
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  planning_category TEXT NOT NULL,
  month TEXT NOT NULL,
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plan_id, planning_category, month)
);

CREATE TABLE IF NOT EXISTS budget_notes (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT,
  monthly_cents INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categorization_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  source_transaction_id TEXT NOT NULL,
  label TEXT NOT NULL,
  from_category TEXT NOT NULL,
  to_category TEXT NOT NULL,
  rule_id INTEGER,
  adjustment_id INTEGER,
  recurring_payee_key TEXT,
  recurring_account_id TEXT,
  prior_recurring_choice_json TEXT,
  written_recurring_choice_json TEXT,
  undone_at TEXT
);

CREATE TABLE IF NOT EXISTS categorization_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  priority INTEGER NOT NULL DEFAULT 100,
  memo_contains TEXT,
  payee_contains TEXT,
  description_contains TEXT,
  mcc TEXT,
  account_id TEXT,
  amount_cents INTEGER,
  amount_min_cents INTEGER,
  amount_max_cents INTEGER,
  action TEXT NOT NULL DEFAULT 'categorize',
  to_category TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS category_mappings (
  source_category TEXT PRIMARY KEY,
  planning_category TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS category_settings (
  planning_category TEXT PRIMARY KEY,
  recurring INTEGER,
  recurring_source TEXT,
  pinned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  timestamp TEXT NOT NULL,
  actor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_quality_flags (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL,
  resolution TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goal_account_links (
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('entire', 'fixed')),
  amount_cents INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (goal_id, account_id)
);

CREATE TABLE IF NOT EXISTS "goals" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal_type TEXT NOT NULL DEFAULT 'savings',
  target_amount_cents INTEGER NOT NULL,
  target_date TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  current_amount_cents INTEGER NOT NULL DEFAULT 0,
  planned_monthly_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  ongoing_monthly_cents INTEGER NOT NULL DEFAULT 0,
  ongoing_started_period TEXT,
  ongoing_budget_line TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS holdings (
  account_id TEXT NOT NULL,
  symbol TEXT,
  description TEXT,
  shares TEXT,
  cost_basis_cents INTEGER,
  market_value_cents INTEGER,
  purchase_price_cents INTEGER,
  currency TEXT,
  as_of TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS maaser_marks (
  source_transaction_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('not_maaser', 'income')),
  counted_cents INTEGER,
  updated_at TEXT NOT NULL,
  CHECK (kind = 'income' OR counted_cents IS NULL)
);

CREATE TABLE IF NOT EXISTS merchant_renames (
  source_key TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_suggestion_dismissals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('same-letters', 'same-person', 'payment')),
  from_name TEXT NOT NULL,
  into_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "recurring_choices" (
  payee_key TEXT NOT NULL,
  account_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  choice TEXT NOT NULL CHECK (choice IN ('recurring', 'not_recurring')),
  cadence TEXT CHECK (cadence IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual')),
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (payee_key, account_id, amount_cents),
  CHECK ((choice = 'recurring') = (cadence IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS scenario_expense_deltas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  planning_category TEXT NOT NULL,
  period TEXT,
  delta_cents INTEGER NOT NULL,
  from_period TEXT
);

CREATE TABLE IF NOT EXISTS scenario_income_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  from_period TEXT NOT NULL,
  net_monthly_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scenario_line_overrides (
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  planning_category TEXT NOT NULL,
  amount_cents INTEGER,
  cut INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  base_amount_cents INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scenario_id, planning_category)
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  income_kind TEXT NOT NULL,
  income_tier_id TEXT,
  income_mode TEXT,
  income_start_period TEXT,
  income_custom_cents INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS simplefin_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_url TEXT,
  last_synced_at TEXT,
  earliest_backfilled TEXT,
  last_errors TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS snapshot_history (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  as_of TEXT NOT NULL,
  drawable_cents INTEGER,
  burn3mo_cents INTEGER,
  burn12mo_cents INTEGER,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT,
  inserted INTEGER DEFAULT 0,
  updated INTEGER DEFAULT 0,
  message TEXT
);

CREATE TABLE IF NOT EXISTS transaction_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_kind TEXT NOT NULL,
  source_transaction_id TEXT,
  match_category TEXT,
  match_amount_cents INTEGER,
  action TEXT NOT NULL,
  note TEXT,
  to_category TEXT
);

CREATE TABLE IF NOT EXISTS transaction_notes (
  source_transaction_id TEXT PRIMARY KEY,
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  source_transaction_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  source_category TEXT,
  merchant TEXT,
  is_transfer INTEGER NOT NULL DEFAULT 0,
  source_updated_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  memo TEXT,
  payee TEXT,
  mcc TEXT,
  pending INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'monarch'
);

CREATE TABLE IF NOT EXISTS what_if_changes (
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  planning_category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  from_period TEXT NOT NULL,
  until_period TEXT,
  loan_price_cents INTEGER,
  loan_down_payment_cents INTEGER,
  loan_annual_rate REAL,
  loan_years INTEGER,
  loan_property_tax_year_cents INTEGER,
  loan_insurance_year_cents INTEGER,
  PRIMARY KEY (scenario_id, id)
);

CREATE TABLE IF NOT EXISTS what_if_goal_picks (
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (scenario_id, goal_id)
);

CREATE TABLE IF NOT EXISTS what_if_rows (
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  is_on INTEGER NOT NULL,
  PRIMARY KEY (scenario_id, kind, ref_id)
);

CREATE TABLE IF NOT EXISTS what_if_settings (
  scenario_id TEXT PRIMARY KEY REFERENCES scenarios(id) ON DELETE CASCADE,
  salary_gross_annual_cents INTEGER,
  salary_from_period TEXT,
  additional_kind TEXT,
  additional_amount_cents INTEGER,
  additional_from_period TEXT
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cost_cents INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'wish',
  target_date TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  planning_category TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS budget_changes_changed ON budget_changes(plan_id, planning_category, from_month) WHERE reason = 'changed';

CREATE UNIQUE INDEX IF NOT EXISTS budget_changes_goal ON budget_changes(plan_id, goal_id) WHERE reason = 'goal';

CREATE INDEX IF NOT EXISTS categorization_log_created ON categorization_log(created_at);

CREATE UNIQUE INDEX IF NOT EXISTS goal_account_links_entire_once ON goal_account_links(account_id) WHERE mode = 'entire';

CREATE INDEX IF NOT EXISTS idx_budget_notes_plan ON budget_notes(plan_id);

CREATE INDEX IF NOT EXISTS idx_budget_plan ON budget_lines(plan_id);

CREATE INDEX IF NOT EXISTS idx_data_quality_flags_plan ON data_quality_flags(plan_id);

CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);

CREATE INDEX IF NOT EXISTS idx_rules_priority ON categorization_rules(priority, id);

CREATE INDEX IF NOT EXISTS idx_scenario_deltas_scenario ON scenario_expense_deltas(scenario_id);

CREATE INDEX IF NOT EXISTS idx_scenario_steps_scenario ON scenario_income_steps(scenario_id);

CREATE INDEX IF NOT EXISTS idx_scenarios_plan ON scenarios(plan_id);

CREATE INDEX IF NOT EXISTS idx_snapshot_history_plan ON snapshot_history(plan_id);

CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date);

CREATE INDEX IF NOT EXISTS idx_txn_pending ON transactions(pending) WHERE pending = 1;

CREATE INDEX IF NOT EXISTS idx_txn_source ON transactions(source);

CREATE INDEX IF NOT EXISTS idx_what_if_changes_order ON what_if_changes(scenario_id, position);

CREATE INDEX IF NOT EXISTS idx_what_if_rows_order ON what_if_rows(scenario_id, position);
