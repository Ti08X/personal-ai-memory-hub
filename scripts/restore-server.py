"""Restore a private encrypted D1 export to a NEW SQLite file, never overwrite.
Run only while source writes/background jobs are frozen. No plaintext is emitted.
"""
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys
import os

TABLES = ['clients','records','record_versions','conflicts','conversations','import_batches','audit_log','record_evidence','dashboard_auth','dashboard_recovery_codes','model_usage','model_settings','memory_classifications','memory_overview_state','memory_overview_versions','strategy_state','strategy_versions','library_settings','library_labels','library_scopes','library_members','library_summary_versions','library_source_errors','library_import_receipts','library_label_keys']

def statements(sql):
    start = index = 0
    quoted = comment = False
    while index < len(sql):
        char = sql[index]
        if comment:
            if char == '\n': comment = False
        elif not quoted and sql[index:index+2] == '--': comment = True
        elif char == "'":
            if quoted and sql[index:index+2] == "''": index += 1
            else: quoted = not quoted
        elif char == ';' and not quoted:
            yield sql[start:index+1]
            start = index+1
        index += 1
    if quoted: raise ValueError('Unterminated SQL string')

def restore(source, target):
    source, target = Path(source).resolve(), Path(target).resolve()
    manifest = json.loads((source/'manifest.json').read_text())
    if set(manifest['tables']) != set(TABLES): raise ValueError('Incomplete migration backup')
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor=os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    db=sqlite3.connect(target)
    try:
        db.executescript((source/'schema.sql').read_text())
        db.execute('BEGIN IMMEDIATE')
        for table in TABLES:
            for stmt in statements((source/(table+'.sql')).read_text()):
                stmt = re.sub(r'^\s*(?:--[^\n]*\n\s*)*', '', stmt)
                if re.match(r'^INSERT\s+INTO\s+["`]?'+table+r'\b', stmt, re.I): db.execute(stmt)
        db.execute("INSERT INTO record_search(record_search) VALUES('rebuild')")
        db.execute('CREATE TABLE server_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)')
        for migration in manifest['migrations']: db.execute('INSERT INTO server_migrations VALUES(?,?)',(migration,manifest['created_at']))
        db.commit()
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        counts={table:db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0] for table in TABLES}
        # Digests cover complete rows/ciphertext; they let destination verification
        # compare copies without disclosing original contents or credential hashes.
        digests={}
        for table in TABLES:
            rows=sorted(json.dumps(list(row),ensure_ascii=False,separators=(',',':')) for row in db.execute('SELECT * FROM '+table))
            digests[table]=hashlib.sha256('\n'.join(rows).encode()).hexdigest()
        result={'integrity':'ok','foreign_keys':'ok','counts':counts,'table_sha256':digests,'ephemeral_sessions':'not_restored','vectors':'rebuild_from_originals'}
        target.with_suffix('.migration.json').write_text(json.dumps(result,indent=2)+'\n');target.with_suffix('.migration.json').chmod(0o600)
        print(json.dumps({'integrity':'ok','counts':counts,'destination':str(target)}))
    finally: db.close()

if __name__=='__main__': restore(*sys.argv[1:])
