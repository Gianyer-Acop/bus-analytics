# Database abstraction layer for SQLite and PostgreSQL
import os
import sqlite3
try:
    import psycopg2
    import psycopg2.extras
    HAS_POSTGRES = True
except ImportError:
    HAS_POSTGRES = False

DATABASE_URL = os.environ.get('DATABASE_URL')
USE_POSTGRES = DATABASE_URL is not None and HAS_POSTGRES

def get_db_connection():
    """Get database connection (SQLite or PostgreSQL)"""
    if USE_POSTGRES:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False
        return conn
    else:
        DB_FILE = "bus_analysis.db"
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        return conn

def get_cursor(conn):
    """Get cursor with appropriate factory"""
    if USE_POSTGRES:
        return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    else:
        return conn.cursor()

def param_placeholder():
    """Return parameter placeholder for SQL queries"""
    return "%s" if USE_POSTGRES else "?"

def init_database():
    """Initialize database tables"""
    conn = get_db_connection()
    c = get_cursor(conn)
    
    # SQL syntax differences
    if USE_POSTGRES:
        serial = "SERIAL PRIMARY KEY"
        text = "TEXT"
        timestamp = "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
    else:
        serial = "INTEGER PRIMARY KEY AUTOINCREMENT"
        text = "TEXT"
        timestamp = "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        # Enable Foreign Keys for SQLite
        c.execute("PRAGMA foreign_keys = ON;")
    
    # Users Table
    c.execute(f'''CREATE TABLE IF NOT EXISTS users (
        id {serial},
        username {text} UNIQUE NOT NULL,
        password {text} NOT NULL,
        role {text} NOT NULL DEFAULT 'COMMON'
    )''')

    # Bus Lines Daily Data Table
    c.execute(f'''CREATE TABLE IF NOT EXISTS bus_lines (
        id {serial},
        date {text} NOT NULL,
        line_code {text} NOT NULL,
        line_name {text},
        company {text} NOT NULL,
        predicted_passengers REAL DEFAULT 0,
        realized_passengers REAL DEFAULT 0,
        UNIQUE(date, line_code, company)
    )''')

    # Occurrences / Analysis Table
    c.execute(f'''CREATE TABLE IF NOT EXISTS occurrences (
        id {serial},
        bus_line_id INTEGER NOT NULL,
        description {text} NOT NULL,
        action_taken {text},
        author_id INTEGER,
        created_at {timestamp},
        FOREIGN KEY (bus_line_id) REFERENCES bus_lines(id),
        FOREIGN KEY (author_id) REFERENCES users(id)
    )''')

    # Line Groups (Blocks) Table
    c.execute(f'''CREATE TABLE IF NOT EXISTS line_groups (
        id {serial},
        name {text} UNIQUE NOT NULL,
        color {text} DEFAULT '#3b82f6'
    )''')

    # Line Group Members Table
    c.execute(f'''CREATE TABLE IF NOT EXISTS line_group_members (
        group_id INTEGER NOT NULL,
        line_code {text} NOT NULL UNIQUE,
        FOREIGN KEY (group_id) REFERENCES line_groups(id) ON DELETE CASCADE,
        UNIQUE(group_id, line_code)
    )''')

    # Line Analyses / File Attachments Table
    c.execute(f'''CREATE TABLE IF NOT EXISTS line_analyses (
        id {serial},
        line_code {text} NOT NULL,
        description {text},
        filename {text},
        original_filename {text},
        author_id INTEGER,
        created_at {timestamp},
        FOREIGN KEY (author_id) REFERENCES users(id)
    )''')

    # Line Actions / Comments Table
    c.execute(f'''CREATE TABLE IF NOT EXISTS line_actions (
        id {serial},
        line_code {text} NOT NULL,
        comment {text} NOT NULL,
        implementation_date {text},
        author_id INTEGER,
        created_at {timestamp},
        impact_conclusion {text},
        FOREIGN KEY (author_id) REFERENCES users(id)
    )''')

    conn.commit()
    
    # Check if we need to create default users
    c.execute("SELECT COUNT(*) as count FROM users")
    result = c.fetchone()
    user_count = result['count'] if USE_POSTGRES else result[0]
    
    if user_count == 0:
        print("Creating default users...")
        ph = param_placeholder()
        c.execute(f"INSERT INTO users (username, password, role) VALUES ({ph}, {ph}, {ph})",
                  ('master', 'admin123', 'MASTER'))
        c.execute(f"INSERT INTO users (username, password, role) VALUES ({ph}, {ph}, {ph})",
                  ('user', 'user123', 'COMMON'))
        conn.commit()
    
    conn.close()
    print(f"Database initialized successfully! (Using {'PostgreSQL' if USE_POSTGRES else 'SQLite'})")
