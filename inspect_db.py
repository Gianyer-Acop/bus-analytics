import sqlite3
import os

DB_FILE = "bus_analysis.db"

if not os.path.exists(DB_FILE):
    print(f"File {DB_FILE} not found.")
else:
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [row[0] for row in c.fetchall()]
    print("Tables in database:")
    for t in tables:
        print(f"- {t}")
        # Get columns for each table
        c.execute(f"PRAGMA table_info({t});")
        cols = [col[1] for col in c.fetchall()]
        print(f"  Columns: {', '.join(cols)}")
    conn.close()
