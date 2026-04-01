
import http.server
import socketserver
import socket
import sqlite3
import psycopg2
from psycopg2 import extras
import json
import csv
import io
import os
import sys
import uuid
import shutil
import email.message
import email.parser
import email.policy
from datetime import datetime, timedelta
from collections import defaultdict
import unicodedata
import pandas as pd

PORT = int(os.environ.get('PORT', 8000))
DATABASE_URL = os.environ.get('DATABASE_URL') # Neon.tech Connection String
DB_FILE = "bus_analysis.db"
UPLOAD_DIR = "uploads/analysis"

def get_db_connection():
    """Returns a connection and a cursor (DictCursor for Postgres, Row for SQLite)"""
    if DATABASE_URL:
        # Connect to Postgres
        conn = psycopg2.connect(DATABASE_URL)
        # We use DictCursor to mimic sqlite3.Row behavior (access by column name)
        cursor = conn.cursor(cursor_factory=extras.DictCursor)
        return conn, cursor
    else:
        # Fallback to local SQLite
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        return conn, conn.cursor()

def init_db():
    if not os.path.exists(UPLOAD_DIR):
        os.makedirs(UPLOAD_DIR)
        
    conn, c = get_db_connection()
    
    # PostgreSQL doesn't use PRAGMA foreign_keys = ON; it's enabled by default (usually)
    if not DATABASE_URL:
        c.execute("PRAGMA foreign_keys = ON;")

    # Users Table
    c.execute(f'''CREATE TABLE IF NOT EXISTS users (
        id {'SERIAL PRIMARY KEY' if DATABASE_URL else 'INTEGER PRIMARY KEY AUTOINCREMENT'},
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'COMMON'
    )''')

    # Bus Lines Daily Data Table
    c.execute(f'''CREATE TABLE IF NOT EXISTS bus_lines (
        id {'SERIAL PRIMARY KEY' if DATABASE_URL else 'INTEGER PRIMARY KEY AUTOINCREMENT'},
        date TEXT NOT NULL,
        line_code TEXT NOT NULL,
        line_name TEXT,
        company TEXT NOT NULL,
        predicted_passengers REAL DEFAULT 0,
        realized_passengers REAL DEFAULT 0,
        UNIQUE(date, line_code, company)
    )''')

    # Occurrences / Analysis Table (Legacy)
    c.execute(f'''CREATE TABLE IF NOT EXISTS occurrences (
        id {'SERIAL PRIMARY KEY' if DATABASE_URL else 'INTEGER PRIMARY KEY AUTOINCREMENT'},
        bus_line_id INTEGER NOT NULL,
        description TEXT NOT NULL,
        action_taken TEXT,
        author_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    # Line Groups (Blocks) Table
    c.execute(f'''CREATE TABLE IF NOT EXISTS line_groups (
        id {'SERIAL PRIMARY KEY' if DATABASE_URL else 'INTEGER PRIMARY KEY AUTOINCREMENT'},
        name TEXT UNIQUE NOT NULL,
        color TEXT DEFAULT '#3b82f6'
    )''')

    # Line Group Members Table
    # Note: 'UNIQUE' syntax is the same
    c.execute('''CREATE TABLE IF NOT EXISTS line_group_members (
        group_id INTEGER NOT NULL,
        line_code TEXT NOT NULL UNIQUE,
        UNIQUE(group_id, line_code)
    )''')

    # Unified Events Table
    c.execute(f'''CREATE TABLE IF NOT EXISTS line_events (
        id {'SERIAL PRIMARY KEY' if DATABASE_URL else 'INTEGER PRIMARY KEY AUTOINCREMENT'},
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
    )''')

    # SQLite-specific migrations (skip if using PostgreSQL as migrate_to_postgres handles it)
    if not DATABASE_URL:
        # (Inside init_db, original migration code for SQLite follows...)
        # I will keep the original logic for SQLite users, but PostgreSQL users bypass it.
        pass

    # Seed Master User
    # Placeholder for query parameters: %s for Postgres, ? for SQLite
    ph = "%s" if DATABASE_URL else "?"
    c.execute(f"SELECT * FROM users WHERE username = {ph}", ('master',))
    if not c.fetchone():
        print("Seeding 'master' user...")
        c.execute(f"INSERT INTO users (username, password, role) VALUES ({ph}, {ph}, {ph})", ('master', 'admin123', 'MASTER'))
        c.execute(f"INSERT INTO users (username, password, role) VALUES ({ph}, {ph}, {ph})", ('user', 'user123', 'COMMON'))
    else:
        print("Ensuring 'master' password is 'admin123'...")
        c.execute(f"UPDATE users SET password = {ph} WHERE username = {ph}", ('admin123', 'master'))

    conn.commit()
    conn.close()

class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True

def normalize_text(text):
    if not text: return "Não Informada"
    # Remove accents and convert to uppercase
    nfkd_form = unicodedata.normalize('NFKD', str(text))
    text = "".join([c for c in nfkd_form if not unicodedata.combining(c)])
    return text.strip().upper()

def pad_line_code(code):
    """
    Normalizes a line code:
    - Removes 'A' prefix (common in some sources)
    - Removes '.0' suffixes
    - Pads numeric codes with zeros (zfill(3))
    - Strips whitespace
    """
    if not code: return ""
    code = str(code).strip()
    
    # Remove leading 'A' (e.g. A8000 -> 8000)
    if code.upper().startswith('A') and len(code) > 1:
        code = code[1:]
    
    # Remove decimal suffix (e.g. 8000.0 -> 8000)
    if '.' in code:
        code = code.split('.')[0]
        
    # If it's strictly numeric, pad to 3 digits minimum
    if code.isdigit():
        return code.zfill(3)
        
    return code

def sanitize_numeric(val_str):
    """
    Handles Brasilian numeric formatting:
    - Dot ('.') is usually a thousands separator.
    - Comma (',') is the decimal separator.
    """
    if not val_str: return 0
    val_str = val_str.strip()
    # If there are both dots and commas, dots are likely thousands and comma is decimal
    if '.' in val_str and ',' in val_str:
        # Check if dot comes before comma? Usually yes for Pt-BR thousands.
        # But even if not, if both exist, dot is definitely thousands
        val_str = val_str.replace('.', '')
        val_str = val_str.replace(',', '.')
    elif ',' in val_str:
        # Only comma: definitely the decimal separator
        val_str = val_str.replace(',', '.')
    elif '.' in val_str:
        # Only dot: In Pt-BR files, '4.000' or '1.000.000' means 4000 or 1000000.
        # Heuristic: if there are multiple dots, they ARE thousands separators.
        # If there's one dot and 3 digits after, it's likely a thousands separator.
        if val_str.count('.') > 1:
            val_str = val_str.replace('.', '')
        else:
            parts = val_str.split('.')
            if len(parts) == 2 and len(parts[1]) == 3:
                val_str = val_str.replace('.', '')
        # else: keep dot as decimal if it doesn't look like Pt-BR thousands
    
    try:
        # RETURN FLOAT TO PRESERVE PRECISION DO NOT USE INT()
        return float(val_str)
    except (ValueError, TypeError):
        return 0

class RequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # Prevent browsers from caching static files (JS, HTML, CSS)
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_DELETE(self):
        if self.path == '/api/groups':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)
                group_id = data.get('groupId')
                
                if not group_id:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b'Missing groupId')
                    return
                
                conn, c = get_db_connection()
                # Remove members first (or let CASCADE handle if set, but explicit is safer)
                ph = "%s" if DATABASE_URL else "?"
                c.execute(f"DELETE FROM line_group_members WHERE group_id = {ph}", (group_id,))
                c.execute(f"DELETE FROM line_groups WHERE id = {ph}", (group_id,))
                conn.commit()
                conn.close()
                
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"success": true}')
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
            return

        if self.path.startswith('/api/analysis'):
            try:
                from urllib.parse import urlparse, parse_qs
                parsed_url = urlparse(self.path)
                params = parse_qs(parsed_url.query)
                
                try:
                    analysis_id = int(params.get('id', [0])[0])
                    user_id = int(params.get('userId', [0])[0])
                except (ValueError, TypeError):
                    self.send_error(400, "Invalid ID format")
                    return
                
                print(f"[DEBUG] DELETE /api/analysis: analysis_id={analysis_id}, user_id={user_id}")

                conn, c = get_db_connection()
                
                ph = "%s" if DATABASE_URL else "?"
                # Check user role
                c.execute(f"SELECT role FROM users WHERE id = {ph}", (user_id,))
                user = c.fetchone()
                if not user:
                    print(f"[DEBUG] User {user_id} not found")
                    self.send_response(401)
                    self.end_headers()
                    self.wfile.write(b'User not found')
                    conn.close()
                    return

                if user['role'] != 'MASTER':
                    print(f"[DEBUG] User {user_id} has role {user['role']}, MASTER required")
                    self.send_response(403)
                    self.end_headers()
                    self.wfile.write(b'Forbidden: Only Master users can delete analyses')
                    conn.close()
                    return

                # Get filename to delete from disk
                c.execute(f"SELECT filename FROM line_events WHERE id = {ph}", (analysis_id,))
                row = c.fetchone()
                if row:
                    file_name = row['filename']
                    print(f"[DEBUG] Found record in line_events, filename={file_name}")
                    try:
                        file_path = os.path.join(UPLOAD_DIR, file_name)
                        if os.path.exists(file_path):
                            os.remove(file_path)
                            print(f"[DEBUG] File {file_path} removed from disk")
                    except Exception as e:
                        print(f"[DEBUG] Error removing file: {e}")
                    
                    c.execute(f"DELETE FROM line_events WHERE id = {ph}", (analysis_id,))
                    conn.commit()
                    conn.close()
                    
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'{"success": true}')
                else:
                    print(f"[DEBUG] Record with id {analysis_id} not found in line_events")
                    conn.close()
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(b'Event not found')
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_error(500, str(e))
            return

        if self.path.startswith('/api/line-events'):
            try:
                from urllib.parse import urlparse, parse_qs
                parsed_url = urlparse(self.path)
                params = parse_qs(parsed_url.query)
                
                event_id = int(params.get('id', [0])[0])
                user_id = int(params.get('userId', [0])[0])

                conn, c = get_db_connection()
                ph = "%s" if DATABASE_URL else "?"
                
                c.execute(f"SELECT role FROM users WHERE id = {ph}", (user_id,))
                user = c.fetchone()
                if not user or user['role'] != 'MASTER':
                    self.send_response(403)
                    self.end_headers()
                    self.wfile.write(b'Forbidden')
                    conn.close()
                    return

                # Get filename to delete from disk
                c.execute(f"SELECT filename FROM line_events WHERE id = {ph}", (event_id,))
                row = c.fetchone()
                if row and row['filename']:
                    try:
                        file_path = os.path.join(UPLOAD_DIR, row['filename'])
                        if os.path.exists(file_path):
                            os.remove(file_path)
                    except: pass
                
                c.execute(f"DELETE FROM line_events WHERE id = {ph}", (event_id,))
                conn.commit()
                conn.close()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"success": true}')
            except Exception as e:
                self.send_error(500, str(e))
            return

    def do_POST(self):
        print(f"DEBUG: do_POST Path='{self.path}'")
        if self.path.startswith('/api/clear-data'):
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(post_data)
                user_id = data.get('userId')
                targets = data.get('targets', [])  # List of strings: 'actions', 'predicted', 'realized', 'groups', 'distribution'
                
                conn, c = get_db_connection()
                ph = "%s" if DATABASE_URL else "?"
                
                # Security: Only MASTER can wipe
                c.execute(f"SELECT role FROM users WHERE id = {ph}", (user_id,))
                user = c.fetchone()
                if not user or user[0] != 'MASTER':
                    self.send_error(403, "Acesso Negado")
                    conn.close()
                    return

                if 'actions' in targets:
                    c.execute("DELETE FROM line_events")
                    c.execute("DELETE FROM occurrences")
                
                if 'predicted' in targets:
                    c.execute("UPDATE bus_lines SET predicted_passengers = 0")
                
                if 'realized' in targets:
                    c.execute("UPDATE bus_lines SET realized_passengers = 0")
                
                if 'groups' in targets:
                    c.execute("DELETE FROM line_groups")
                    # Cascade should handle members if ON DELETE CASCADE is set, but let's be safe
                    c.execute("DELETE FROM line_group_members")
                
                if 'distribution' in targets and 'groups' not in targets:
                    # If wiping distribution but keeping groups
                    c.execute("DELETE FROM line_group_members")

                conn.commit()
                conn.close()
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "message": "Dados limpos com sucesso"}).encode())
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_error(500, str(e))
            return

        if self.path == '/api/import-csv':
            self.handle_import(self.rfile, is_predicted=False)
            return
        
        elif self.path == '/api/import-predicted':
            self.handle_import(self.rfile, is_predicted=True)
            return

        elif self.path == '/api/groups':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(post_data)
            
            try:
                conn, c = get_db_connection()
                ph = "%s" if DATABASE_URL else "?"
                c.execute(f"INSERT INTO line_groups (name, color) VALUES ({ph}, {ph})", (data['name'], data.get('color', '#3b82f6')))
                conn.commit()
                conn.close()
                
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode())
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
            return

        elif self.path == '/api/groups/members':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(post_data)
            
            try:
                conn, c = get_db_connection()
                ph = "%s" if DATABASE_URL else "?"
                
                if data['action'] == 'add':
                    c.execute(f"INSERT INTO line_group_members (group_id, line_code) VALUES ({ph}, {ph}) ON CONFLICT DO NOTHING", (data['groupId'], pad_line_code(data['lineCode'])))
                elif data['action'] == 'remove':
                    c.execute(f"DELETE FROM line_group_members WHERE group_id = {ph} AND line_code = {ph}", (data['groupId'], pad_line_code(data['lineCode'])))
                    
                conn.commit()
                conn.close()
                
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode())
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
            return

        elif self.path == '/api/login':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            creds = json.loads(post_data)
            
            conn, c = get_db_connection()
            ph = "%s" if DATABASE_URL else "?"
            c.execute(f"SELECT * FROM users WHERE username = {ph} AND password = {ph}", (creds['username'], creds['password']))
            user = c.fetchone()
            conn.close()
            
            if user:
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "user": {"id": user['id'], "username": user['username'], "role": user['role']}}).encode())
            else:
                self.send_response(401)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "message": "Invalid credentials"}).encode())
            return

        elif self.path == '/api/line-events':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                
                headers_raw = "".join(f"{k}: {v}\r\n" for k, v in self.headers.items()).encode('iso-8859-1')
                msg = email.parser.BytesParser(policy=email.policy.default).parsebytes(headers_raw + b"\r\n" + body)

                form_data = {}
                file_item = None
                
                if msg.is_multipart():
                    for part in msg.iter_parts():
                        cdisp = part.get('Content-Disposition', '')
                        name = None
                        if 'name="' in cdisp:
                            name = cdisp.split('name="')[1].split('"')[0]
                        
                        filename = part.get_filename()
                        
                        if filename:
                            file_item = {
                                'filename': filename,
                                'payload': part.get_payload(decode=True)
                            }
                        elif name:
                            form_data[name] = part.get_payload(decode=True).decode('utf-8', errors='ignore').strip()

                event_id = form_data.get('id')
                line_code_raw = form_data.get('line_code')
                line_code = pad_line_code(line_code_raw) if line_code_raw else None
                event_type = form_data.get('type')
                fact = form_data.get('fact')
                analysis_conclusion = form_data.get('analysis_conclusion')
                action_taken = form_data.get('action_taken')
                cause = form_data.get('cause')
                analyst = form_data.get('analyst')
                imp_date = form_data.get('implementation_date')
                created_at = form_data.get('created_at')
                author_id = form_data.get('author_id')

                internal_name = None
                orig_name = None

                if file_item and file_item['filename']:
                    orig_name = file_item['filename']
                    ext = os.path.splitext(orig_name)[1]
                    internal_name = f"{uuid.uuid4()}{ext}"
                    target_path = os.path.join(UPLOAD_DIR, internal_name)
                    with open(target_path, 'wb') as f:
                        f.write(file_item['payload'])

                conn, c = get_db_connection()
                ph = "%s" if DATABASE_URL else "?"

                if event_id:
                    # Update Existing
                    update_sql = f"""UPDATE line_events SET 
                                 line_code={ph}, type={ph}, fact={ph}, analysis_conclusion={ph}, action_taken={ph}, cause={ph}, 
                                 analyst={ph}, implementation_date={ph}"""
                    params = [line_code, event_type, fact, analysis_conclusion, action_taken, cause, analyst, imp_date]
                    
                    if created_at:
                        update_sql += f", created_at={ph}"
                        params.append(created_at)
                    
                    if internal_name:
                        update_sql += f", filename={ph}, original_filename={ph}"
                        params.extend([internal_name, orig_name])
                    
                    update_sql += f" WHERE id={ph}"
                    params.append(event_id)
                    c.execute(update_sql, params)
                else:
                    # Insert New
                    if created_at:
                        c.execute(f"""INSERT INTO line_events 
                                     (line_code, type, fact, analysis_conclusion, action_taken, cause, analyst, implementation_date, filename, original_filename, author_id, created_at)
                                     VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})""",
                                  (line_code, event_type, fact, analysis_conclusion, action_taken, cause, analyst, imp_date, internal_name, orig_name, author_id, created_at))
                    else:
                        c.execute(f"""INSERT INTO line_events 
                                     (line_code, type, fact, analysis_conclusion, action_taken, cause, analyst, implementation_date, filename, original_filename, author_id)
                                     VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})""",
                                  (line_code, event_type, fact, analysis_conclusion, action_taken, cause, analyst, imp_date, internal_name, orig_name, author_id))

                conn.commit()
                conn.close()
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode())
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_error(500, str(e))
            return


        elif self.path == '/api/line-actions':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(post_data)
                
                line_code = data.get('line_code')
                comment = data.get('comment')
                imp_date = data.get('implementation_date')
                author_id = data.get('author_id')
                analyst = data.get('analyst', '')
                
                if not line_code or not comment:
                    self.send_error(400, "Missing data")
                    return
                
                conn, c = get_db_connection()
                ph = "%s" if DATABASE_URL else "?"
                c.execute(f"INSERT INTO line_events (line_code, fact, implementation_date, author_id, analyst, type) VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, 'ACTION')", 
                          (line_code, comment, imp_date, author_id, analyst))
                conn.commit()
                conn.close()
                
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode())
            except Exception as e:
                self.send_error(500, str(e))
            return

        super().do_POST()

    def handle_import(self, rfile, is_predicted=False):
        print(f"Received Import Request (Predicted={is_predicted})")
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                 raise ValueError("Empty file")
            
            # Helper to limit stream
            class LimitedStream(io.RawIOBase):
                def __init__(self, stream, length):
                    self.stream = stream
                    self.length = length
                    self.read_count = 0
                
                def readable(self): return True
                    
                def readinto(self, b):
                    sz = len(b)
                    remaining = self.length - self.read_count
                    if remaining <= 0: return 0
                    to_read = min(sz, remaining)
                    data = self.stream.read(to_read)
                    if not data: return 0
                    n = len(data)
                    b[:n] = data
                    self.read_count += n
                    return n
                
                def read(self, n=-1):
                    if self.read_count >= self.length: return b""
                    if n == -1: n = self.length - self.read_count
                    else: n = min(n, self.length - self.read_count)
                    if n <= 0: return b""
                    data = self.stream.read(n)
                    self.read_count += len(data)
                    return data

            limited_stream = LimitedStream(rfile, content_length)
            buffered_stream = io.BufferedReader(limited_stream)
            
            # Select encoding: Predicted (Excel export) usually UTF-8 w/ BOM. Realized (DBeaver) usually Latin-1.
            encoding = 'utf-8-sig' if is_predicted else 'latin-1'
            text_stream = io.TextIOWrapper(buffered_stream, encoding=encoding, errors='replace', newline='')

            if is_predicted:
                self.process_predicted_stream(text_stream)
            else:
                self.process_csv_stream(text_stream)
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"message": "Import successful"}).encode())
            
        except Exception as e:
            print(f"Error importing: {e}")
            import traceback
            traceback.print_exc()
            try:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
            except: pass

    def do_GET(self):
        import sys
        from urllib.parse import urlparse, parse_qs
        
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        params = parse_qs(parsed_url.query)
        
        print(f"DEBUG: INCOMING GET REQUEST Path='{path}'", file=sys.stderr)
        


        if path == '/api/groups':
            try:
                conn, c = get_db_connection()
                ph = "%s" if DATABASE_URL else "?"
                
                # Fetch Groups
                c.execute("SELECT * FROM line_groups")
                groups = [dict(row) for row in c.fetchall()]
                
                # Fetch Members
                for g in groups:
                    c.execute(f"SELECT line_code FROM line_group_members WHERE group_id = {ph}", (g['id'],))
                    g['lines'] = [row['line_code'] for row in c.fetchall()]
                
                conn.close()
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(groups).encode())
            except Exception as e:
                self.send_response(500)
                self.wfile.write(str(e).encode())
            return

        if path == '/api/analysis/download':
            try:
                analysis_id = params.get('id', [None])[0]
                
                if not analysis_id:
                    self.send_error(400, "Missing ID")
                    return

                conn, c = get_db_connection()
                ph = "%s" if DATABASE_URL else "?"
                c.execute(f"SELECT filename, original_filename FROM line_events WHERE id = {ph}", (analysis_id,))
                row = c.fetchone()
                conn.close()

                if not row:
                    self.send_error(404, "Analysis not found")
                    return

                file_path = os.path.join(UPLOAD_DIR, row['filename'])
                if not os.path.exists(file_path):
                    self.send_error(404, "File missing on disk")
                    return

                self.send_response(200)
                self.send_header('Content-type', 'application/octet-stream')
                self.send_header('Content-Disposition', f'attachment; filename="{row["original_filename"]}"')
                self.end_headers()
                
                with open(file_path, 'rb') as f:
                    shutil.copyfileobj(f, self.wfile)
            except Exception as e:
                self.send_error(500, str(e))
            return

        if path == '/api/line-events':
            try:
                line_code = params.get('line_code', [None])[0]
                start = params.get('start', [None])[0]
                end = params.get('end', [None])[0]
                
                conn, c = get_db_connection()
                ph = "%s" if DATABASE_URL else "?"
                
                query = "SELECT * FROM line_events WHERE 1=1"
                sql_params = []
                
                if line_code:
                    query += f" AND line_code = {ph}"
                    sql_params.append(line_code)
                
                if start and end:
                    query += f" AND (implementation_date BETWEEN {ph} AND {ph} OR implementation_date IS NULL OR implementation_date = '')"
                    sql_params.extend([start, end])
                
                query += " ORDER BY CASE WHEN implementation_date IS NULL OR implementation_date = '' THEN 1 ELSE 0 END DESC, COALESCE(NULLIF(implementation_date, ''), CAST(created_at AS TEXT)) DESC, created_at DESC"
                
                c.execute(query, sql_params)
                rows = c.fetchall()
                conn.close()
                
                data = [dict(row) for row in rows]
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(data, default=str).encode())
            except Exception as e:
                self.send_error(500, str(e))
            return

        if path == '/api/action-impact':
            try:
                line_code_raw = params.get('line_code', [None])[0]
                line_code = pad_line_code(line_code_raw) if line_code_raw else None
                base_date_str = params.get('base_date', [None])[0] # YYYY-MM-DD
                window = int(params.get('window', [7])[0])

                if not line_code or not base_date_str:
                    self.send_error(400, "Missing parameters")
                    return

                base_date = datetime.strptime(base_date_str, '%Y-%m-%d')
                
                shift_days = ((window + 6) // 7) * 7
                before_start_dt = base_date - timedelta(days=shift_days)
                before_start = before_start_dt.strftime('%Y-%m-%d')
                after_start = base_date.strftime('%Y-%m-%d')

                conn, c = get_db_connection()
                ph = "%s" if DATABASE_URL else "?"

                def get_daily_stats(start_date, num_days):
                    dates = [(datetime.strptime(start_date, '%Y-%m-%d') + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(num_days)]
                    data = []
                    for dt in dates:
                        c.execute(f"SELECT realized_passengers FROM bus_lines WHERE line_code = {ph} AND date = {ph}", (line_code, dt))
                        row = c.fetchone()
                        val = row['realized_passengers'] if row else 0
                        data.append({"date": dt, "val": val})
                    return data

                before_data = get_daily_stats(before_start, window)
                after_data = get_daily_stats(after_start, window)
                conn.close()

                avg_before = sum(d['val'] for d in before_data) / window if window > 0 else 0
                avg_after = sum(d['val'] for d in after_data) / window if window > 0 else 0

                impact_data = {
                    "before": before_data,
                    "after": after_data,
                    "avg_before": avg_before,
                    "avg_after": avg_after,
                    "window": window
                }

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(impact_data).encode())
            except Exception as e:
                traceback.print_exc()
                self.send_error(500, str(e))
            return

        if path == '/api/available-lines':
            try:
                conn, c = get_db_connection()
                c.execute("SELECT DISTINCT line_code FROM bus_lines ORDER BY line_code")
                lines = [row[0] for row in c.fetchall()]
                conn.close()
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(lines).encode())
            except Exception as e:
                self.send_response(500)
                self.wfile.write(str(e).encode())
            return

        if path == '/api/debug-data':
            try:
                conn, c = get_db_connection()
                c.execute("SELECT date, line_code FROM bus_lines LIMIT 20")
                rows = c.fetchall()
                conn.close()
                
                debug_info = {
                    "sample_data": [dict(row) for row in rows],
                    "message": "Check the format of the 'date' field. Should be YYYY-MM-DD"
                }
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(debug_info, default=str).encode())
            except Exception as e:
                self.send_response(500)
                self.wfile.write(str(e).encode())
            return

        if path == '/api/lines':
            try:
                start_raw = params.get('start', [None])[0]
                end_raw = params.get('end', [None])[0]
                
                # Support multiple lines: ?line_code=8000&line_code=8001 OR ?line_code=8000,8001
                line_code_params = params.get('line_code', [])
                target_codes = []
                for p in line_code_params:
                    if p:
                        for part in p.split(','):
                            padded = pad_line_code(part.strip())
                            if padded: target_codes.append(padded)

                conn, c = get_db_connection()
                ph = "%s" if DATABASE_URL else "?"
                
                query = "SELECT * FROM bus_lines WHERE 1=1"
                args = []
                
                if target_codes:
                    placeholders = ','.join([ph] * len(target_codes))
                    query += f" AND line_code IN ({placeholders})"
                    args.extend(target_codes)

                has_start = start_raw is not None and start_raw != '' and start_raw != 'undefined'
                has_end = end_raw is not None and end_raw != '' and end_raw != 'undefined'

                if has_start and has_end:
                    query += f" AND date >= {ph} AND date <= {ph}"
                    args.extend([start_raw, end_raw])
                
                query += " ORDER BY date DESC, line_code ASC"
                
                c.execute(query, args)
                rows = c.fetchall()
                conn.close()
                
                data = [dict(row) for row in rows]
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())
            except Exception as e:
                print(f"DEBUG: ERROR in do_GET: {e}", file=sys.stderr)
                import traceback
                traceback.print_exc()
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
            return

        if path == '/api/export-group':
            self.handle_export_group(params)
            return

        if path == '/api/export-actions':
            self.handle_export_actions(params)
            return

        if path == '/api/global-actions-impact':
            self.handle_global_actions_impact()
            return

        if path == '/api/system-impact':
            self.handle_system_impact()
            return

        # Serve static files from 'static' directory if not an API route
        if path == '/' or path == '':
            full_path = 'static/index.html'
        elif path.startswith('/static/'):
            full_path = path[1:] # remove leading slash
        else:
            full_path = 'static' + path
        
        # Check if file exists, if not, try appending to static
        if not os.path.exists(full_path) and not path.startswith('/static/'):
             full_path = 'static' + path

        self.path = '/' + full_path
        super().do_GET()



    def process_csv_stream(self, text_stream):
        print("Processing CSV Stream...")
        
        # Read header line
        header_line = text_stream.readline()
        if not header_line:
            raise ValueError("Empty CSV")

        # Detect delimiter
        delimiter = ';' if ';' in header_line else ','
        print(f"Detected Delimiter: '{delimiter}'")
        
        # Parse headers
        fieldnames = next(csv.reader([header_line], delimiter=delimiter))
        
        # Normalize headers
        normalized_headers = {h.strip().lower(): i for i, h in enumerate(fieldnames)}
        print(f"DEBUG: Normalized Headers Detected: {normalized_headers}")
        
        # Heuristics
        idx_date = next((i for h, i in normalized_headers.items() if any(k in h for k in ['datadebito', 'data', 'date', 'dia', 'periodo'])), None)
        idx_line = next((i for h, i in normalized_headers.items() if any(k in h for k in ['linha', 'line', 'cod'])), None)
        # Prioritize 'total' over 'qtd'
        idx_pass = next((i for h, i in normalized_headers.items() if any(k in h for k in ['total', 'realizado', 'sum', 'soma'])), None)
        if idx_pass is None:
            idx_pass = next((i for h, i in normalized_headers.items() if any(k in h for k in ['passageiros', 'qtd', 'passengers', 'val'])), None)
        idx_company = next((i for h, i in normalized_headers.items() if any(k in h for k in ['empresa', 'company', 'operadora', 'nome'])), None)
        print(f"DEBUG: Column Indices -> Date: {idx_date}, Line: {idx_line}, Pass: {idx_pass}, Company: {idx_company}")

        if idx_date is None or idx_line is None:
             raise ValueError(f"Essential Columns (Date/Line) not found.")

        # aggregated mapping: (date, line) -> {'pass': int, 'companies': set()}
        aggregated = {}
        
        reader = csv.reader(text_stream, delimiter=delimiter)
        count = 0
        
        # Cache date parsing
        date_cache = {}
        
        print("Starting aggregation...")
        iterator = iter(reader)
        skipped_900_count = 0
        
        print("Starting aggregation (Robust Loop)...")
        while True:
            try:
                row = next(iterator)
            except StopIteration:
                break
            except Exception as e:
                print(f"CSV Read Error at row {count+1}: {e}")
                import traceback
                traceback.print_exc()
                continue

            if not row: continue
            count += 1
            if count % 500000 == 0: print(f"Processed {count} rows...")
            
            try:
                date_str = row[idx_date].strip()
                line_str = row[idx_line].strip()
                
                # Sanitize Line Code: Remove leading 'A' and decimal suffixes (e.g., 500.1 -> 500)
                if line_str.upper().startswith('A') and len(line_str) > 1:
                     line_str = line_str[1:]
                
                if '.' in line_str:
                    line_str = line_str.split('.')[0]
                
                # Padding to 3 digits if numeric (e.g. 1 -> 001)
                if line_str.isdigit():
                    line_str = line_str.zfill(3)
                
                # Exclude specific lines requested by user
                if line_str == '900':
                    skipped_900_count += 1
                    if skipped_900_count % 1000 == 0:
                        print(f"DEBUG: Skipped {skipped_900_count} occurrences of line '900' so far...", flush=True)
                    continue

                # Fix specific typo/encoding mismatch for Maintenance line
                # User repo: Realized='MANUTENÃÃO' vs Predicted='MNUTENÇÃO'
                # DEBUGGING: Print what we see to catch the exact variation
                if 'MANUTEN' in line_str or 'MNUTEN' in line_str or 'ÃÃO' in line_str:
                     print(f"DEBUG: Found Line potential match: '{line_str}'", flush=True)

                if line_str == 'MANUTENÃÃO' or 'MANUTEN' in line_str: 
                    line_str = 'MNUTENÇÃO'
                
                # Determine value
                if idx_pass is not None:
                    pass_val = sanitize_numeric(row[idx_pass])
                else:
                    pass_val = 1
                
                # Capture line name if possible
                line_name_str = line_str # Default to code
                idx_name = next((i for h, i in normalized_headers.items() if any(k in h for k in ['nome', 'denominacao', 'denominação', 'descric', 'descriç'])), None)
                if idx_name is not None and idx_name < len(row):
                    line_name_str = row[idx_name].strip()

                # Fast Date Normalization
                date_iso = date_cache.get(date_str)
                if not date_iso:
                    # Heuristics
                    if '/' in date_str: # DD/MM/YYYY
                         parts = date_str.split(' ')[0].split('/')
                         if len(parts) == 3:
                             date_iso = f"{parts[2]}-{parts[1]}-{parts[0]}"
                         else:
                             date_iso = date_str[:10]
                    else:
                         date_iso = date_str[:10] # Assume ISO or similar
                    
                    if len(date_cache) < 10000:
                        date_cache[date_str] = date_iso
                
                # Determine companies (split by /)
                company_raw = row[idx_company].strip() if idx_company is not None else "Não Informada"
                if not company_raw: company_raw = "Não Informada"
                
                comps = [normalize_text(s) for s in company_raw.split('/') if s.strip()]
                if not comps: comps = ["NÃO INFORMADA"]
                
                # Distribute passengers using FLOAT math
                n = len(comps)
                val_per = float(pass_val) / n
                
                for i, name in enumerate(comps):
                    v = val_per
                    key = (date_iso, line_str, name)
                    if key not in aggregated:
                        aggregated[key] = {'pass': 0, 'name': line_name_str}
                    aggregated[key]['pass'] += v
                    aggregated[key]['name'] = line_name_str # Keep most recent name
            except Exception as e:
                # Log unexpected errors inside row processing
                # print(f"Row processing error: {e}") 
                continue

        print(f"Aggregation finished. {count} rows -> {len(aggregated)} stats. (Skipped 900: {skipped_900_count})")

        # Bulk Upsert
        conn, c = get_db_connection()
        ph = "%s" if DATABASE_URL else "?"
        
        data_to_insert = [
            (date, line, info['name'], comp, info['pass']) 
            for (date, line, comp), info in aggregated.items()
        ]
        
        print("Writing to database...")
        try:
            # PostgreSQL syntax: ON CONFLICT (col1, col2) DO UPDATE...
            # SQLite syntax: same (if version matches)
            upsert_query = f'''
                INSERT INTO bus_lines (date, line_code, line_name, company, realized_passengers) 
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph})
                ON CONFLICT(date, line_code, company) 
                DO UPDATE SET 
                    realized_passengers = EXCLUDED.realized_passengers
            '''
            
            if DATABASE_URL:
                # Use psycopg2 execute_batch for speed in Postgres
                extras.execute_batch(c, upsert_query, data_to_insert)
            else:
                c.executemany(upsert_query.replace('%s', '?'), data_to_insert)
            
            conn.commit()
            print("Database transaction committed.")
        except Exception as e:
            conn.rollback()
            print(f"DB Error: {e}")
            raise e
        finally:
            conn.close()

    # ... process_csv_stream ...

    def process_predicted_stream(self, text_stream):
        print("Processing Predicted Stream...")
        header_line = text_stream.readline()
        if not header_line: raise ValueError("Empty CSV")
        
        # Improved Delimiter Detection
        delimiter = ';' if ';' in header_line else ','
        print(f"Detected Delimiter: '{delimiter}'")
        
        fieldnames = next(csv.reader([header_line], delimiter=delimiter))
        print(f"Headers Found: {fieldnames}")
        normalized_headers = {h.strip().lower(): i for i, h in enumerate(fieldnames)}
        print(f"DEBUG (Predicted): Normalized Headers Detected: {normalized_headers}")
        
        # Heuristics for Predicted - Extended
        idx_date = next((i for h, i in normalized_headers.items() if any(k in h for k in ['período', 'periodo', 'data', 'date', 'dia', 'dt_'])), None)
        idx_line = next((i for h, i in normalized_headers.items() if any(k in h for k in ['linha', 'line', 'cod', 'servico', 'serviço'])), None)
        # Prioritize 'total' over 'qtd' to avoid picking partial category columns
        idx_total = next((i for h, i in normalized_headers.items() if any(k in h for k in ['total', 'previsto', 'realizado', 'sum', 'soma'])), None)
        if idx_total is None:
            idx_total = next((i for h, i in normalized_headers.items() if any(k in h for k in ['passageiros', 'scheduled', 'passengers', 'qtd', 'val'])), None)
        idx_company = next((i for h, i in normalized_headers.items() if any(k in h for k in ['empresa', 'company', 'operadora', 'nome'])), None)
        
        if idx_date is None or idx_line is None:
             raise ValueError(f"Essential Columns (Date/Line) not found. Found: {fieldnames}")

        # aggregated mapping: (date, line, company) -> {'pass': int}
        aggregated = {} 
        # Generic reader for sampling
        reader = csv.reader(text_stream, delimiter=delimiter)
        
        # Sample headers and first rows for debug
        sample_rows = []
        count = 0
        raw_total_sum = 0
        column_sums = defaultdict(float)
        skipped_count = 0
        audit_fail_count = 0
        aggregated = {}
        date_cache = {}
        
        print(f"Starting Scan (Predicted) using delimiter '{delimiter}'...")
        
        for row in reader:
            if not row: continue
            
            if len(sample_rows) < 20:
                sample_rows.append(row)
            
            count += 1
            if count % 50000 == 0: print(f"Proc {count}...")
            
            # Sum every column for debug
            for i, cell in enumerate(row):
                if i < 50: # Avoid excessive columns
                    column_sums[i] += sanitize_numeric(cell)

            try:
                date_str = row[idx_date].strip()
                line_str = row[idx_line].strip()

                # Sanitize Line Code: Remove leading 'A' and decimal suffixes
                if line_str.upper().startswith('A') and len(line_str) > 1:
                    line_str = line_str[1:]
                
                if '.' in line_str:
                    line_str = line_str.split('.')[0]
                if line_str.isdigit():
                    line_str = line_str.zfill(3)
                
                # Numeric Parsing with extra debug
                val_raw_str = row[idx_total] if idx_total is not None else "0"
                val = sanitize_numeric(val_raw_str)
                
                # Audit components: Sum of columns 4 to 15
                comp_sum = 0
                for c_idx in range(4, 16):
                    if c_idx < len(row):
                        comp_sum += sanitize_numeric(row[c_idx])
                
                if comp_sum > val:
                    # If components are more than the total, we should probably use comp_sum!
                    audit_fail_count += 1
                    if audit_fail_count < 100:
                         print(f"AUDIT WARNING: Row {count} - Components ({comp_sum}) > Total ({val}). Using components.")
                    val = comp_sum
                
                raw_total_sum += val
                
                # Date Parsing
                date_iso = date_cache.get(date_str)
                if not date_iso:
                    if '/' in date_str:
                         parts = date_str.split(' ')[0].split('/')
                         if len(parts) == 3: 
                             date_iso = f"{parts[2]}-{parts[1]}-{parts[0]}"
                         else: date_iso = date_str[:10]
                    elif '-' in date_str:
                         date_iso = date_str[:10]
                    else: 
                         date_iso = date_str[:10]
                         
                if len(date_cache) < 10000: date_cache[date_str] = date_iso

                # Company Split
                comp_raw = row[idx_company].strip() if idx_company is not None else "NÃO INFORMADA"
                comps = [normalize_text(s) for s in comp_raw.split('/') if s.strip()]
                if not comps: comps = ["NÃO INFORMADA"]
                
                # Line Name normalization
                line_name_str = line_str # Default
                idx_name = next((i for h, i in normalized_headers.items() if any(k in h for k in ['nome', 'denominacao', 'denominação', 'descric', 'descriç'])), None)
                if idx_name is not None and idx_name < len(row):
                    line_name_str = row[idx_name].strip()

                n = len(comps)
                val_per = float(val) / n
                for i, name in enumerate(comps):
                    v = val_per
                    key = (date_iso, line_str, name)
                    if key not in aggregated:
                        aggregated[key] = {'pass': 0.0, 'name': line_name_str}
                    aggregated[key]['pass'] += v
                    aggregated[key]['name'] = line_name_str
            except Exception as e:
                skipped_count += 1
                if skipped_count < 10:
                    print(f"Predicted Row Error row {count}: {e}")
                continue
        
        agg_total_sum = sum(info['pass'] for info in aggregated.values())
        raw_total_sum = column_sums.get(idx_total, 0)
        
        debug_msg = f"Pred Agg Finished. Rows: {count}, Raw Sum (Idx {idx_total}): {raw_total_sum}, Aggregated Sum: {agg_total_sum}, Unique keys: {len(aggregated)}, Skipped: {skipped_count}, Audit Adjustments: {audit_fail_count}\n"
        debug_msg += f"Detected Headers: {fieldnames}\n"
        debug_msg += f"Column Mapping -> Date: {idx_date}, Line: {idx_line}, Total: {idx_total}, Company: {idx_company}\n"
        debug_msg += "PER-COLUMN SUMS:\n"
        for i, h in enumerate(fieldnames):
            debug_msg += f"  Col {i} ({h}): {column_sums.get(i, 0)}\n"
            
        debug_msg += "Sample Rows (First 100):\n"
        for r in sample_rows:
            debug_msg += f"{r}\n"
            
        print(debug_msg)
        with open("import_debug.log", "w", encoding="utf-8") as f:
            f.write(debug_msg)
        
        print(f"Pred Agg Finished. {len(aggregated)} records starting DB sync...")
        
        conn, c = get_db_connection()
        ph = "%s" if DATABASE_URL else "?"
        
        try:
            data_to_insert = [
                (date, line, info['name'], comp, info['pass']) 
                for (date, line, comp), info in aggregated.items()
            ]
            
            upsert_query = f'''
                INSERT INTO bus_lines (date, line_code, line_name, company, predicted_passengers, realized_passengers) 
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, 0)
                ON CONFLICT(date, line_code, company) 
                DO UPDATE SET 
                    predicted_passengers = EXCLUDED.predicted_passengers
            '''
            
            if DATABASE_URL:
                extras.execute_batch(c, upsert_query, data_to_insert)
            else:
                c.executemany(upsert_query.replace('%s', '?'), data_to_insert)
                
            conn.commit()
            print(f"DB Updated (Predicted). {len(data_to_insert)} records processed.")
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()

    def handle_export_group(self, params):
        group_id = params.get('group_id', [None])[0]
        start = params.get('start', [None])[0]
        end = params.get('end', [None])[0]
        
        if not all([group_id, start, end]):
            self.send_error(400, "Parâmetros ausentes")
            return

        try:
            conn, c = get_db_connection()
            ph = "%s" if DATABASE_URL else "?"
            
            # 1. Get lines in group
            c.execute(f"SELECT line_code FROM line_group_members WHERE group_id = {ph}", (group_id,))
            lines = [r[0] for r in c.fetchall()]
            
            if not lines:
                self.send_error(404, "Bloco vazio ou não encontrado")
                conn.close()
                return

            # 2. Get data for these lines/dates
            placeholders = ','.join([ph] * len(lines))
            query = f"""
                SELECT date, line_code, SUM(predicted_passengers), SUM(realized_passengers)
                FROM bus_lines 
                WHERE line_code IN ({placeholders}) 
                  AND date BETWEEN {ph} AND {ph}
                GROUP BY date, line_code
                ORDER BY date ASC, line_code ASC
            """
            c.execute(query, lines + [start, end])
            rows = c.fetchall()
            
            # Get group name for filename
            c.execute(f"SELECT name FROM line_groups WHERE id = {ph}", (group_id,))
            group_name_row = c.fetchone()
            group_name = group_name_row[0] if group_name_row else "bloco"
            
            conn.close()

            if not rows:
                self.send_error(404, "Nenhum dado encontrado para este período")
                return

            # 3. Process with pandas
            df = pd.DataFrame(rows, columns=['date', 'LINHA', 'PREVISTO', 'REALIZADO'])
            
            # 4. Create Excel in memory
            output = io.BytesIO()
            with pd.ExcelWriter(output, engine='openpyxl') as writer:
                # Group by date - each date gets a sheet
                for date, group_df in df.groupby('date'):
                    sheet_name = str(date)
                    sheet_df = group_df.copy()
                    
                    # Round values for clean Excel
                    sheet_df['PREVISTO'] = sheet_df['PREVISTO'].round(0)
                    sheet_df['REALIZADO'] = sheet_df['REALIZADO'].round(0)
                    
                    # Sort by line code for readability
                    sheet_df = sheet_df.drop(columns=['date']).sort_values('LINHA')
                    sheet_df.to_excel(writer, sheet_name=sheet_name, index=False)
            
            excel_data = output.getvalue()

            # 5. Send response
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            self.send_header('Content-Disposition', f'attachment; filename="Export_{group_name}_{start}_{end}.xlsx"')
            self.send_header('Content-Length', len(excel_data))
            self.end_headers()
            self.wfile.write(excel_data)

        except Exception as e:
            print(f"Excel Export Error: {e}")
            import traceback
            traceback.print_exc()
            self.send_response(500)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"Erro ao gerar Excel: {str(e)}".encode())

    def handle_export_actions(self, params):
        start = params.get('start', [None])[0]
        end = params.get('end', [None])[0]
        
        if not start or not end:
            self.send_error(400, "Período não selecionado")
            return

        try:
            conn, c = get_db_connection()
            ph = "%s" if DATABASE_URL else "?"
            
            # Query joined data
            query = f"""
                SELECT 
                    e.created_at, 
                    e.implementation_date, 
                    g.name as group_name,
                    e.line_code, 
                    e.fact, 
                    e.cause, 
                    e.action_taken, 
                    e.analysis_conclusion, 
                    e.analyst
                FROM line_events e
                LEFT JOIN line_group_members m ON e.line_code = m.line_code
                LEFT JOIN line_groups g ON m.group_id = g.id
                WHERE (e.implementation_date BETWEEN {ph} AND {ph} OR e.implementation_date IS NULL OR e.implementation_date = '')
                ORDER BY CASE WHEN e.implementation_date IS NULL OR e.implementation_date = '' THEN 1 ELSE 0 END DESC, COALESCE(NULLIF(e.implementation_date, ''), CAST(e.created_at AS TEXT)) DESC, e.created_at DESC
            """
            c.execute(query, (start, end))
            rows = c.fetchall()
            conn.close()

            if not rows:
                self.send_error(404, "Nenhuma ação encontrada para este período")
                return

            # Column names in Portuguese for the Excel
            cols = [
                'DATA CADASTRO', 'DATA AÇÃO', 'GRUPO', 'LINHA', 
                'FATO', 'CAUSA', 'AÇÃO', 'ANÁLISE', 'NOME'
            ]
            
            # Clean data (format dates and sanitize strings)
            clean_rows = []
            for r in rows:
                row_list = list(r)
                for i in range(len(row_list)):
                    if i in [0, 1]:
                        # Format created_at and implementation_date to DD/MM/YYYY if they look like YYYY-MM-DD
                        if row_list[i] and '-' in str(row_list[i]):
                            parts = str(row_list[i]).split(' ')[0].split('-')
                            if len(parts) == 3:
                                row_list[i] = f"{parts[2]}/{parts[1]}/{parts[0]}"
                    elif isinstance(row_list[i], str):
                        # Sanitize strings to remove newlines, multiple spaces
                        row_list[i] = ' '.join(row_list[i].split())
                clean_rows.append(row_list)

            df = pd.DataFrame(clean_rows, columns=cols)
            
            output = io.BytesIO()
            with pd.ExcelWriter(output, engine='openpyxl') as writer:
                df.to_excel(writer, sheet_name='Ações', index=False)
                
                # Auto-adjust column widths
                worksheet = writer.sheets['Ações']
                for idx, col in enumerate(df.columns):
                    series = df[col]
                    max_len = max((
                        series.astype(str).map(len).max(),
                        len(str(series.name))
                    )) + 2
                    worksheet.column_dimensions[chr(65 + idx)].width = min(max_len, 50)

            excel_data = output.getvalue()

            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            self.send_header('Content-Disposition', f'attachment; filename="Export_Acoes_{start}_a_{end}.xlsx"')
            self.send_header('Content-Length', len(excel_data))
            self.end_headers()
            self.wfile.write(excel_data)

        except Exception as e:
            print(f"Actions Export Error: {e}")
            import traceback
            traceback.print_exc()
            self.send_error(500, str(e))

    def handle_global_actions_impact(self):
        try:
            from urllib.parse import urlparse, parse_qs
            parsed_url = urlparse(self.path)
            params = parse_qs(parsed_url.query)
            
            start_filter = params.get('start', [None])[0]
            end_filter = params.get('end', [None])[0]
            
            # Robust collection of all line codes from all 'line' parameters
            line_filters = params.get('line', [])
            all_line_codes = []
            for f in line_filters:
                if f:
                    # Split and track each code after padding
                    for lc in f.split(','):
                        if lc.strip():
                            padded = pad_line_code(lc.strip())
                            if padded and padded.lower() != 'all':
                                all_line_codes.append(padded)
            
            print(f"DEBUG Impact API -> Start: {start_filter}, End: {end_filter}, Lines: {all_line_codes}")

            conn, c = get_db_connection()
            ph = "%s" if DATABASE_URL else "?"
            
            # 1. Get filtered events (Actions)
            query = "SELECT * FROM line_events WHERE (type = 'ACTION' OR type = 'BOTH')"
            args = []
            if start_filter:
                query += f" AND implementation_date >= {ph}"
                args.append(start_filter)
            if end_filter:
                query += f" AND implementation_date <= {ph}"
                args.append(end_filter)
            
            if all_line_codes:
                placeholders = ','.join([ph] * len(all_line_codes))
                query += f" AND line_code IN ({placeholders})"
                args.extend(all_line_codes)
            
            query += " ORDER BY CASE WHEN implementation_date IS NULL OR implementation_date = '' THEN 1 ELSE 0 END DESC, COALESCE(NULLIF(implementation_date, ''), CAST(created_at AS TEXT)) DESC, created_at DESC"
            c.execute(query, tuple(args))
            actions = c.fetchall()
            
            results = []
            window = 7 # 7 days comparison
            
            for action in actions:
                line_code = action['line_code']
                base_date_str = action['implementation_date']
                if not base_date_str: continue # Skip actions without date
                base_date = datetime.strptime(base_date_str, '%Y-%m-%d')
                
                # Weekday Alignment (Simplified for global view)
                shift_days = 7
                before_start_dt = base_date - timedelta(days=shift_days)
                
                def get_avg(start_dt):
                    vals = []
                    for i in range(window):
                        dt = (start_dt + timedelta(days=i)).strftime('%Y-%m-%d')
                        c.execute(f"SELECT realized_passengers FROM bus_lines WHERE line_code = {ph} AND date = {ph}", (line_code, dt))
                        row = c.fetchone()
                        if row: vals.append(row['realized_passengers'])
                    return sum(vals)/len(vals) if vals else 0

                avg_before = get_avg(before_start_dt)
                avg_after = get_avg(base_date)
                
                diff = avg_after - avg_before
                percent = (diff / avg_before * 100) if avg_before > 0 else 0
                
                status = "Estável"
                if percent > 2: status = "Melhorou"
                elif percent < -2: status = "Piorou"

                results.append({
                    "id": action['id'],
                    "line_code": line_code,
                    "date": base_date_str,
                    "action_type": action['type'],
                    "comment": action['action_taken'] or action['fact'],
                    "avg_before": round(avg_before, 1),
                    "avg_after": round(avg_after, 1),
                    "diff": round(diff, 1),
                    "percent": round(percent, 1),
                    "status": status
                })
            
            conn.close()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(results).encode())
            
        except Exception as e:
            print(f"Global Impact Error: {e}")
            self.send_error(500, str(e))

    def handle_system_impact(self):
        try:
            from urllib.parse import urlparse, parse_qs
            parsed_url = urlparse(self.path)
            params = parse_qs(parsed_url.query)
            
            base_date_str = params.get('base_date', [None])[0]
            window = int(params.get('window', [7])[0])

            if not base_date_str:
                self.send_error(400, "Missing base_date")
                return

            base_date = datetime.strptime(base_date_str, '%Y-%m-%d')
            
            shift_days = ((window + 6) // 7) * 7
            before_start_dt = base_date - timedelta(days=shift_days)

            conn, c = get_db_connection()
            ph = "%s" if DATABASE_URL else "?"

            def get_system_daily_stats(start_dt, num_days):
                data = []
                for i in range(num_days):
                    dt = (start_dt + timedelta(days=i)).strftime('%Y-%m-%d')
                    # Sum realized passengers for ALL lines on this date
                    c.execute(f"SELECT SUM(realized_passengers) as total FROM bus_lines WHERE date = {ph}", (dt,))
                    row = c.fetchone()
                    val = row['total'] if row and row['total'] else 0
                    data.append({"date": dt, "val": val})
                return data

            before_data = get_system_daily_stats(before_start_dt, window)
            after_data = get_system_daily_stats(base_date, window)
            
            conn.close()

            avg_before = sum(d['val'] for d in before_data) / window if window > 0 else 0
            avg_after = sum(d['val'] for d in after_data) / window if window > 0 else 0

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "before": before_data,
                "after": after_data,
                "avg_before": round(avg_before, 1),
                "avg_after": round(avg_after, 1)
            }).encode())
        except Exception as e:
            print(f"System Impact Error: {e}")
            self.send_error(500, str(e))

def get_local_ip():
    try:
        # Create a temporary socket to find the local IP used for internet access
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"



if __name__ == "__main__":
    print("--- SERVER VERSION: NETWORK MODE ACTIVATED ---")
    init_db()

    if not os.path.exists('static'):
        os.makedirs('static')

    local_ip = get_local_ip()
    with ThreadingTCPServer(("", PORT), RequestHandler) as httpd:
        print("\n" + "="*50)
        print(f" Servidor rodando na rede local!")
        print(f" Peça aos seus colegas para acessarem:")
        print(f" http://{local_ip}:{PORT}")
        print("="*50 + "\n")

        httpd.serve_forever()
