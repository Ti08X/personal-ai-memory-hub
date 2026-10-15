-- Source text remains in records. Labels and summary bodies are encrypted.
CREATE TABLE library_settings (
 owner_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 1, lease_until TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE library_labels (
 owner_id TEXT NOT NULL, record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
 source_version INTEGER NOT NULL, classification_revision INTEGER NOT NULL, revision INTEGER NOT NULL,
 payload_cipher TEXT NOT NULL, method TEXT NOT NULL, updated_at TEXT NOT NULL, extracted INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(owner_id,record_id)
);
CREATE TABLE library_scopes (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, scope_key TEXT NOT NULL,
 title_cipher TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', generation INTEGER NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 0, cursor INTEGER NOT NULL DEFAULT 0, covered INTEGER NOT NULL DEFAULT 0,
 payload_cipher TEXT, work_cipher TEXT, invalid_before INTEGER NOT NULL DEFAULT 0,
 error_code TEXT, attempts INTEGER NOT NULL DEFAULT 0, retry_at TEXT, updated_at TEXT NOT NULL,
 UNIQUE(owner_id,kind,scope_key)
);
CREATE INDEX library_scopes_pending ON library_scopes(owner_id,status,retry_at);
CREATE TABLE library_members (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, scope_id TEXT NOT NULL REFERENCES library_scopes(id) ON DELETE CASCADE,
 record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE, source_version INTEGER NOT NULL,
 classification_revision INTEGER NOT NULL, UNIQUE(scope_id,record_id)
);
CREATE INDEX library_members_source ON library_members(record_id,scope_id);
CREATE INDEX library_members_cursor ON library_members(scope_id,seq);
CREATE TABLE library_summary_versions (
 scope_id TEXT NOT NULL REFERENCES library_scopes(id) ON DELETE CASCADE, revision INTEGER NOT NULL,
 payload_cipher TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY(scope_id,revision)
);
CREATE TABLE library_source_errors (
 owner_id TEXT NOT NULL, record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
 source_version INTEGER NOT NULL, error_code TEXT NOT NULL, attempts INTEGER NOT NULL,
 retry_at TEXT NOT NULL, PRIMARY KEY(owner_id,record_id)
);
CREATE TABLE library_import_receipts (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, batch_id TEXT NOT NULL, client_id TEXT NOT NULL,
 saved INTEGER NOT NULL, duplicates INTEGER NOT NULL, conflicts INTEGER NOT NULL, received_at TEXT NOT NULL
);
CREATE INDEX library_receipts_owner ON library_import_receipts(owner_id,received_at DESC);
CREATE TABLE library_label_keys (
 owner_id TEXT NOT NULL,record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
 source_version INTEGER NOT NULL,classification_revision INTEGER NOT NULL,
 kind TEXT NOT NULL,key_hash TEXT NOT NULL,PRIMARY KEY(owner_id,record_id,kind,key_hash)
);
CREATE INDEX library_label_keys_lookup ON library_label_keys(owner_id,kind,key_hash,record_id);
-- A source edit/delete/reclassification immediately hides all affected summaries.
-- Old encrypted bodies remain for audit, but cannot outlive removed evidence.
CREATE TRIGGER library_record_update AFTER UPDATE OF version ON records WHEN new.version!=old.version BEGIN
 UPDATE library_scopes SET status='pending',generation=generation+1,cursor=0,covered=0,work_cipher=NULL,
 invalid_before=revision+1,error_code=NULL,retry_at=NULL
 WHERE id IN (SELECT scope_id FROM library_members WHERE record_id=old.id);
END;
CREATE TRIGGER library_record_delete BEFORE DELETE ON records BEGIN
 UPDATE library_scopes SET status='pending',generation=generation+1,cursor=0,covered=0,work_cipher=NULL,
 invalid_before=revision+1,error_code=NULL,retry_at=NULL
 WHERE id IN (SELECT scope_id FROM library_members WHERE record_id=old.id);
END;
CREATE TRIGGER library_classification_update AFTER UPDATE OF revision ON memory_classifications WHEN new.revision!=old.revision BEGIN
 UPDATE library_scopes SET status='pending',generation=generation+1,cursor=0,covered=0,work_cipher=NULL,
 invalid_before=revision+1,error_code=NULL,retry_at=NULL
 WHERE id IN (SELECT scope_id FROM library_members WHERE record_id=old.record_id);
END;
