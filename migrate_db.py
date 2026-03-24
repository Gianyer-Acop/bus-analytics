"""
One-time database migration script:
Renames stale line_events columns to match the current server.py schema.
"""
import sqlite3

DB_FILE = "bus_analysis.db"

conn = sqlite3.connect(DB_FILE)
c = conn.cursor()

# Check current schema
c.execute("PRAGMA table_info(line_events)")
cols = {row[1]: row for row in c.fetchall()}
print("Current line_events columns:", list(cols.keys()))

needs_migration = 'event_type' in cols or 'action_description' in cols

if needs_migration:
    print("Stale schema detected. Performing migration...")

    # Count existing rows for reference
    row_count = c.execute("SELECT COUNT(*) FROM line_events").fetchone()[0]
    print(f"Existing rows in line_events: {row_count}")

    # Create new table with correct schema
    c.execute("""CREATE TABLE IF NOT EXISTS line_events_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        line_code TEXT NOT NULL,
        type TEXT NOT NULL,
        fact TEXT,
        analysis_conclusion TEXT,
        action_taken TEXT,
        filename TEXT,
        original_filename TEXT,
        analyst TEXT,
        implementation_date TEXT,
        author_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")

    # Copy data from old table, mapping old column names to new
    c.execute("""
        INSERT INTO line_events_new
            (id, line_code, type, fact, analysis_conclusion, action_taken,
             filename, analyst, implementation_date, author_id, created_at)
        SELECT
            id,
            line_code,
            COALESCE(event_type, 'ANALYSIS'),
            fact,
            analysis_conclusion,
            action_description,
            analysis_file,
            analyst,
            action_date,
            author_id,
            created_at
        FROM line_events
    """)

    migrated = c.execute("SELECT COUNT(*) FROM line_events_new").fetchone()[0]
    print(f"Migrated {migrated} rows to new schema.")

    # Swap tables
    c.execute("DROP TABLE line_events")
    c.execute("ALTER TABLE line_events_new RENAME TO line_events")
    print("Migration complete. line_events now has correct schema.")
else:
    print("Schema already up-to-date. No migration needed.")

conn.commit()
conn.close()

# Verify
conn = sqlite3.connect(DB_FILE)
c = conn.cursor()
c.execute("PRAGMA table_info(line_events)")
print("Final columns:", [row[1] for row in c.fetchall()])
c.execute("SELECT COUNT(*) FROM line_events")
print("Total rows:", c.fetchone()[0])
conn.close()
