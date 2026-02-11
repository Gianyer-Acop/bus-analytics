#!/usr/bin/env python3
"""
Script to replace all sqlite3.connect(DB_FILE) calls with get_db_connection()
and update parameter placeholders to work with both SQLite and PostgreSQL.
"""

import re

# Read the file
with open('server.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace sqlite3.connect(DB_FILE) with get_db_connection()
content = content.replace('sqlite3.connect(DB_FILE)', 'get_db_connection()')

# Replace conn.row_factory = sqlite3.Row (not needed with get_db_connection)
content = re.sub(r'\s+conn\.row_factory = sqlite3\.Row\n', '', content)

# Save the file
with open('server.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Replaced all sqlite3.connect(DB_FILE) with get_db_connection()")
print("✅ Removed redundant conn.row_factory assignments")
print("\nNext: Update parameter placeholders from ? to work with both databases")
