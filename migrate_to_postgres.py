import sqlite3
import psycopg2
from psycopg2 import extras
import os
import sys

# Configurações
SQLITE_DB = "bus_analysis.db"
# A DATABASE_URL deve ser definida no ambiente ou colada aqui temporariamente
DATABASE_URL = os.environ.get('DATABASE_URL')

if not DATABASE_URL:
    print("ERRO: A variável de ambiente DATABASE_URL não foi encontrada.")
    print("Como usar: set DATABASE_URL=postgres://usuario:senha@host/banco && python migrate_to_postgres.py")
    sys.exit(1)

def migrate():
    print(f"--- Iniciando Migração de {SQLITE_DB} para PostgreSQL ---")
    
    try:
        # 1. Conectar ao SQLite
        sqlite_conn = sqlite3.connect(SQLITE_DB)
        sqlite_conn.row_factory = sqlite3.Row
        sqlite_cur = sqlite_conn.cursor()
        
        # 2. Conectar ao PostgreSQL
        pg_conn = psycopg2.connect(DATABASE_URL)
        pg_cur = pg_conn.cursor()
        
        # 3. Criar Tabelas no PostgreSQL (Sintaxe Adaptada)
        print("Criando tabelas no PostgreSQL...")
        
        tables_schema = [
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'COMMON'
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS bus_lines (
                id SERIAL PRIMARY KEY,
                date TEXT NOT NULL,
                line_code TEXT NOT NULL,
                line_name TEXT,
                company TEXT NOT NULL,
                predicted_passengers REAL DEFAULT 0,
                realized_passengers REAL DEFAULT 0,
                UNIQUE(date, line_code, company)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS occurrences (
                id SERIAL PRIMARY KEY,
                bus_line_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                action_taken TEXT,
                author_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS line_groups (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                color TEXT DEFAULT '#3b82f6'
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS line_group_members (
                group_id INTEGER NOT NULL,
                line_code TEXT NOT NULL UNIQUE,
                UNIQUE(group_id, line_code)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS line_events (
                id SERIAL PRIMARY KEY,
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                cause TEXT
            )
            """
        ]
        
        for sql in tables_schema:
            pg_cur.execute(sql)
        
        pg_conn.commit()
        
        # 4. Migrar Dados
        tables_to_migrate = [
            ('users', ['id', 'username', 'password', 'role']),
            ('line_groups', ['id', 'name', 'color']),
            ('line_group_members', ['group_id', 'line_code']),
            ('bus_lines', ['id', 'date', 'line_code', 'line_name', 'company', 'predicted_passengers', 'realized_passengers']),
            ('line_events', ['id', 'line_code', 'type', 'fact', 'analysis_conclusion', 'action_taken', 'filename', 'original_filename', 'analyst', 'implementation_date', 'author_id', 'created_at', 'cause']),
            ('occurrences', ['id', 'bus_line_id', 'description', 'action_taken', 'author_id', 'created_at'])
        ]
        
        for table, cols in tables_to_migrate:
            print(f"Migrando tabela {table}...")
            sqlite_cur.execute(f"SELECT {', '.join(cols)} FROM {table}")
            rows = sqlite_cur.fetchall()
            
            if not rows:
                print(f"  Tabela {table} vazia. Pulando.")
                continue
                
            # Limpar tabela destino antes de inserir (opcional, mas seguro para migração limpa)
            pg_cur.execute(f"TRUNCATE TABLE {table} CASCADE")
            
            # Preparar insert
            placeholders = ", ".join(["%s"] * len(cols))
            insert_query = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders})"
            
            # Converter rows para lista de tuplas
            data = [tuple(row) for row in rows]
            
            extras.execute_batch(pg_cur, insert_query, data)
            print(f"  {len(rows)} registros migrados para {table}.")

            # Atualizar sequência do SERIAL para não dar erro de Primary Key duplicada depois
            if 'id' in cols:
                pg_cur.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), coalesce(max(id), 1), max(id) IS NOT NULL) FROM {table}")

        pg_conn.commit()
        print("--- Migração concluída com sucesso! ---")
        
    except Exception as e:
        print(f"ERRO durante a migração: {e}")
        if pg_conn: pg_conn.rollback()
    finally:
        if sqlite_conn: sqlite_conn.close()
        if pg_conn: pg_conn.close()

if __name__ == "__main__":
    migrate()
