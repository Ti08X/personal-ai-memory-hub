CREATE TABLE dashboard_auth (
 singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
 username TEXT NOT NULL UNIQUE,
 password_salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 totp_cipher TEXT NOT NULL,
 client_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 last_totp_step INTEGER NOT NULL,
 enabled_at TEXT NOT NULL
);
CREATE TABLE dashboard_auth_pending (
 singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
 username TEXT NOT NULL,
 password_salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 totp_cipher TEXT NOT NULL,
 client_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE TABLE dashboard_auth_challenges (
 id TEXT PRIMARY KEY,
 client_id TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE TABLE dashboard_recovery_codes (
 code_hash TEXT PRIMARY KEY,
 created_at TEXT NOT NULL
);
CREATE TABLE dashboard_auth_attempts (
 bucket_key TEXT NOT NULL,
 bucket INTEGER NOT NULL,
 count INTEGER NOT NULL,
 PRIMARY KEY(bucket_key,bucket)
);
