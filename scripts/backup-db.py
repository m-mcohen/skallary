"""Back up the live database before a restart that runs migrations.

Uses the SQLite backup API (the live database keeps recent changes in a WAL file, so a
plain file copy can miss them) and opens the source read-only. Prints the backup's path,
its integrity check and row counts that must match the source.

Usage from the checkout root:  python scripts/backup-db.py <label>
"""
import datetime
import os
import sqlite3
import sys

label = sys.argv[1] if len(sys.argv) > 1 else "manual"
folder = os.path.join(os.environ["LOCALAPPDATA"], "finance")
src = os.path.join(folder, "finance.db")
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
dst = os.path.join(folder, f"finance.db.bak-{label}-{stamp}")

s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
t = sqlite3.connect(dst)
s.backup(t)
print(dst)
print("integrity", t.execute("pragma integrity_check").fetchone()[0])
for table in ["accounts", "transactions", "_migrations"]:
    a = s.execute(f"select count(*) from {table}").fetchone()[0]
    b = t.execute(f"select count(*) from {table}").fetchone()[0]
    print(table, a, b, "match" if a == b else "MISMATCH")
print("last migration", t.execute("select max(name) from _migrations").fetchone()[0])
s.close()
t.close()
