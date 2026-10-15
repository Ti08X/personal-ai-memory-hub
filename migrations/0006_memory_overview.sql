CREATE TABLE memory_classifications (
 owner_id TEXT NOT NULL, record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
 source_version INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 categories_json TEXT NOT NULL, payload_cipher TEXT, method TEXT NOT NULL,
 updated_at TEXT NOT NULL, PRIMARY KEY(owner_id,record_id)
);
CREATE INDEX memory_classifications_owner ON memory_classifications(owner_id,source_version);
CREATE TABLE memory_overview_state (
 owner_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
 control_version INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0,
 payload_cipher TEXT, error_code TEXT, updated_at TEXT NOT NULL, lease_until TEXT
);
CREATE TABLE memory_overview_versions (
 owner_id TEXT NOT NULL, revision INTEGER NOT NULL, payload_cipher TEXT NOT NULL,
 saved_at TEXT NOT NULL, PRIMARY KEY(owner_id,revision)
);
