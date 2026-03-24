import sqlite3

DB_FILE = "bus_analysis.db"

def migrate():
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        
        c.execute("PRAGMA table_info(line_events)")
        existing_cols = [row[1] for row in c.fetchall()]
        
        if 'cause' not in existing_cols:
            print("Adding 'cause' column...")
            c.execute("ALTER TABLE line_events ADD COLUMN cause TEXT")
            conn.commit()
            print("Migration successful.")
        else:
            print("'cause' column already exists.")
            
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    migrate()
