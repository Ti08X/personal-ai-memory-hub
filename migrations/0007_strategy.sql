CREATE TABLE strategy_state (
 owner_id TEXT PRIMARY KEY,
 draft_version INTEGER NOT NULL DEFAULT 0,
 draft_cipher TEXT NOT NULL,
 published_version INTEGER NOT NULL DEFAULT 0,
 published_cipher TEXT,
 published_at TEXT,
 updated_at TEXT NOT NULL
);
CREATE TABLE strategy_versions (
 owner_id TEXT NOT NULL,
 version INTEGER NOT NULL,
 payload_cipher TEXT NOT NULL,
 published_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,version)
);
