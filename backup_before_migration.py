
import json
import os
import psycopg2
from psycopg2 import extras
import sqlite3
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get('DATABASE_URL')
DB_FILE = "bus_analysis.db"
BACKUP_DIR = "backups_pre_migration"

def get_db_connection():
    if DATABASE_URL:
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor(cursor_factory=extras.DictCursor)
        return conn, cursor
    else:
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        return conn, conn.cursor()

def backup():
    if not os.path.exists(BACKUP_DIR):
        os.makedirs(BACKUP_DIR)
    
    conn, c = get_db_connection()
    tables = ['line_events', 'line_groups', 'line_group_members', 'bus_lines', 'users']
    
    print(f"Iniciando backup de segurança em {BACKUP_DIR}...")
    
    for table in tables:
        try:
            c.execute(f"SELECT * FROM {table}")
            rows = c.fetchall()
            # Convert rows to list of dicts
            data = [dict(row) for row in rows]
            
            # Simple serializer for datetime if any
            filename = os.path.join(BACKUP_DIR, f"{table}_backup.json")
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4, ensure_ascii=False, default=str)
            print(f"  [OK] Tabela '{table}' salva ({len(data)} registros).")
        except Exception as e:
            print(f"  [ERRO] Falha ao fazer backup da tabela '{table}': {e}")
    
    conn.close()
    print("Backup concluído com sucesso!")

if __name__ == "__main__":
    backup()
