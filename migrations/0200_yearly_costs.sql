CREATE TABLE IF NOT EXISTS yearly_bills (
  id INTEGER PRIMARY KEY,
  planning_category TEXT NOT NULL,
  label TEXT NOT NULL,
  payee_key TEXT NOT NULL,
  account_id TEXT,
  amount_cents INTEGER,
  months TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS yearly_bill_events (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES yearly_bills(id),
  obligation_year INTEGER NOT NULL,
  due_month TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('picked','ticked','still-exists','gone','told-new-amount')),
  source_transaction_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS yearly_bill_events_by_bill ON yearly_bill_events(bill_id);

CREATE TABLE IF NOT EXISTS budget_raises (
  id INTEGER PRIMARY KEY,
  planning_category TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  when_kind TEXT NOT NULL CHECK (when_kind IN ('once','every-year','holiday')),
  month TEXT,
  month_of_year TEXT,
  calendar_id TEXT,
  holiday_key TEXT,
  count_in TEXT NOT NULL DEFAULT 'start' CHECK (count_in IN ('start','end')),
  created_at TEXT NOT NULL,
  archived_at TEXT
);

-- A share belongs to a plan in Lane A's plans table and is deleted with it.
CREATE TABLE IF NOT EXISTS yearly_bill_shares (
  bill_id INTEGER NOT NULL REFERENCES yearly_bills(id),
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  planning_category TEXT NOT NULL,
  cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (bill_id, plan_id)
);

CREATE TABLE IF NOT EXISTS yearly_bill_terms (
  bill_id INTEGER NOT NULL REFERENCES yearly_bills(id),
  from_year INTEGER NOT NULL,
  planning_category TEXT NOT NULL,
  amount_cents INTEGER,
  months TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (bill_id, from_year)
);
