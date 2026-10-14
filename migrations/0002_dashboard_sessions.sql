CREATE TABLE dashboard_sessions (
 id TEXT PRIMARY KEY,
 client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX dashboard_sessions_expiry ON dashboard_sessions(expires_at);
