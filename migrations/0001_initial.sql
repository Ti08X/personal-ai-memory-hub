PRAGMA foreign_keys=ON;
CREATE TABLE clients (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE records (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, record_type TEXT NOT NULL,
 logical_key TEXT, source_platform TEXT NOT NULL, session_id TEXT NOT NULL,
 source_record_id TEXT, source_kind TEXT NOT NULL, source_timestamp TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, client_id TEXT NOT NULL,
 sensitivity TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 content_hash TEXT NOT NULL, payload_cipher TEXT NOT NULL, search_tokens TEXT NOT NULL,
 dedupe_key TEXT NOT NULL, UNIQUE(owner_id,dedupe_key)
);
CREATE INDEX records_context ON records(owner_id,source_timestamp DESC,id);
CREATE INDEX records_kind ON records(owner_id,record_type,source_timestamp DESC);
CREATE INDEX records_session ON records(owner_id,source_platform,session_id);
CREATE TABLE record_versions (
 record_id TEXT NOT NULL, owner_id TEXT NOT NULL, version INTEGER NOT NULL,
 payload_cipher TEXT NOT NULL, sensitivity TEXT NOT NULL, content_hash TEXT NOT NULL,
 source_platform TEXT NOT NULL, source_kind TEXT NOT NULL, source_timestamp TEXT NOT NULL,
 client_id TEXT NOT NULL, saved_at TEXT NOT NULL,
 PRIMARY KEY(record_id,version), FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE
);
CREATE TABLE conflicts (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, record_id TEXT NOT NULL,
 base_version INTEGER NOT NULL, candidate_hash TEXT NOT NULL, payload_cipher TEXT NOT NULL,
 sensitivity TEXT NOT NULL, source_platform TEXT NOT NULL, client_id TEXT NOT NULL,
 created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 UNIQUE(owner_id,record_id,base_version,candidate_hash),
 FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE
);
CREATE TABLE conversations (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, source_platform TEXT NOT NULL,
 session_id TEXT NOT NULL, title_cipher TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(owner_id,source_platform,session_id)
);
CREATE TABLE import_batches (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, source_platform TEXT NOT NULL,
 session_id TEXT NOT NULL, payload_cipher TEXT NOT NULL, client_id TEXT NOT NULL,
 saved_at TEXT NOT NULL, UNIQUE(owner_id,id)
);
CREATE TABLE audit_log (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL,
 action TEXT NOT NULL, target_id TEXT NOT NULL, timestamp TEXT NOT NULL
);
CREATE TABLE rate_limits (client_id TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(client_id,bucket));
CREATE VIRTUAL TABLE record_search USING fts5(search_tokens,content='records',content_rowid='rowid',tokenize='ascii');
CREATE TRIGGER records_ai AFTER INSERT ON records BEGIN
 INSERT INTO record_search(rowid,search_tokens) VALUES(new.rowid,new.search_tokens);
END;
CREATE TRIGGER records_ad AFTER DELETE ON records BEGIN
 INSERT INTO record_search(record_search,rowid,search_tokens) VALUES('delete',old.rowid,old.search_tokens);
END;
CREATE TRIGGER records_au AFTER UPDATE ON records BEGIN
 INSERT INTO record_search(record_search,rowid,search_tokens) VALUES('delete',old.rowid,old.search_tokens);
 INSERT INTO record_search(rowid,search_tokens) VALUES(new.rowid,new.search_tokens);
END;
