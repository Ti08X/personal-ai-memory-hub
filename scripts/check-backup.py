"""Restore encrypted table data into an isolated in-memory SQLite database.

This validates schema/rows/FTS reconstruction without touching the live service
or decrypting/printing personal contents. It is not a cross-account D1 restore.
"""
import json
import re
import sqlite3
import sys
from pathlib import Path


def statements(sql):
    start = 0
    index = 0
    quoted = False
    comment = False
    while index < len(sql):
        char = sql[index]
        if comment:
            if char == '\n':
                comment = False
        elif not quoted and sql[index:index+2] == '--':
            comment = True
        elif char == "'":
            if quoted and sql[index:index+2] == "''":
                index += 1
            else:
                quoted = not quoted
        elif char == ';' and not quoted:
            yield sql[start:index+1]
            start = index+1
        index += 1
    if quoted:
        raise ValueError('Unterminated SQL string')


directory = Path(sys.argv[1]).resolve()
manifest = json.loads((directory/'manifest.json').read_text())
database = sqlite3.connect(':memory:')
database.executescript((directory/'schema.sql').read_text())
for table in manifest['tables']:
    if table not in ['clients', 'records', 'record_versions', 'conflicts', 'conversations', 'import_batches', 'audit_log', 'record_evidence', 'dashboard_auth', 'dashboard_recovery_codes', 'model_usage', 'model_settings', 'memory_classifications', 'memory_overview_state', 'memory_overview_versions','strategy_state','strategy_versions']:
        raise ValueError('Unexpected table')
    for statement in statements((directory/(table+'.sql')).read_text()):
        # Structure is from our migration; copy only data from Wrangler table exports.
        statement = re.sub(r'^\s*(?:--[^\n]*\n\s*)*', '', statement)
        if re.match(r'^INSERT\s+INTO\s+["`]?'+table+r'\b', statement, re.I):
            database.execute(statement)
database.execute("INSERT INTO record_search(record_search) VALUES('rebuild')")
assert database.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert not database.execute('PRAGMA foreign_key_check').fetchall()
counts = {table: database.execute('SELECT count(*) FROM '+table).fetchone()[0] for table in manifest['tables']}
assert database.execute("SELECT count(*) FROM records WHERE payload_cipher NOT LIKE 'v1.%'").fetchone()[0] == 0
sample = database.execute('SELECT search_tokens FROM records LIMIT 1').fetchone()
if sample and sample[0]:
    assert database.execute('SELECT count(*) FROM record_search WHERE record_search MATCH ?', ('"'+sample[0].split()[0]+'"',)).fetchone()[0] > 0
print(json.dumps({'isolated_sqlite_restore': 'passed', 'foreign_keys': 'passed', 'fts_rebuild': 'passed', 'counts': counts}))
