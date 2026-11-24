CREATE TABLE IF NOT EXISTS holiday_calendars (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  "on" INTEGER NOT NULL CHECK ("on" IN (0,1)),
  imported_at TEXT,
  covers_through TEXT
);

CREATE TABLE IF NOT EXISTS holidays (
  calendar_id TEXT NOT NULL REFERENCES holiday_calendars(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  PRIMARY KEY (calendar_id, key, start_date)
);
