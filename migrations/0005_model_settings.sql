-- Provider credentials are encrypted separately from all searchable memory records.
CREATE TABLE model_settings (
 owner_id TEXT PRIMARY KEY,
 payload_cipher TEXT NOT NULL,
 version INTEGER NOT NULL,
 updated_at TEXT NOT NULL
);
