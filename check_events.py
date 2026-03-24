import sqlite3
import json

DB_FILE = "bus_analysis.db"

def check():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    # Check schema
    c.execute("PRAGMA table_info(line_events)")
    cols = [dict(row) for row in c.fetchall()]
    print("Columns in line_events:")
    for col in cols:
        print(f" - {col['name']} ({col['type']})")
    
    # Check latest data
    c.execute("SELECT id, line_code, fact, cause, action_taken, analysis_conclusion FROM line_events ORDER BY created_at DESC LIMIT 5")
    rows = [dict(row) for row in c.fetchall()]
    print("\nLatest 5 events:")
    print(json.dumps(rows, indent=2))
    
    conn.close()

if __name__ == "__main__":
    check()
