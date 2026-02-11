# -*- coding: utf-8 -*-
import re
import sys

# Read file
with open('server.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Process line by line
output_lines = []
skip_next = False

for i, line in enumerate(lines):
    if skip_next:
        skip_next = False
        continue
        
    # Replace sqlite3.connect(DB_FILE) with get_db_connection()
    if 'sqlite3.connect(DB_FILE)' in line:
        line = line.replace('sqlite3.connect(DB_FILE)', 'get_db_connection()')
        output_lines.append(line)
        
        # Check if next line is row_factory, skip it
        if i + 1 < len(lines) and 'conn.row_factory = sqlite3.Row' in lines[i + 1]:
            skip_next = True
        
        # Also replace c = conn.cursor() with c = get_cursor(conn)
        if i + 2 < len(lines) and 'c = conn.cursor()' in lines[i + 2]:
            if skip_next:
                # row_factory was on line i+1, cursor is on i+2
                output_lines.append(lines[i + 2].replace('c = conn.cursor()', 'c = get_cursor(conn)'))
                skip_next = False
                lines[i + 2] = ''  # Mark as processed
    else:
        # Also handle standalone cursor calls
        if 'c = conn.cursor()' in line and line.strip() != '':
            line = line.replace('c = conn.cursor()', 'c = get_cursor(conn)')
        output_lines.append(line)

# Write back
with open('server.py', 'w', encoding='utf-8', newline='') as f:
    f.writelines(output_lines)

print("Migration complete!")
print("- Replaced sqlite3.connect(DB_FILE) with get_db_connection()")
print("- Removed conn.row_factory lines")
print("- Replaced conn.cursor() with get_cursor(conn)")
