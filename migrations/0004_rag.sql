ALTER TABLE clients ADD COLUMN policy_json TEXT;
ALTER TABLE clients ADD COLUMN last_used_at TEXT;
CREATE TABLE rag_jobs (
 owner_id TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 error_code TEXT, updated_at TEXT NOT NULL, lease_until TEXT, mutation_id TEXT, mutation_at TEXT,
 PRIMARY KEY(owner_id,record_id)
);
CREATE INDEX rag_jobs_owner_status ON rag_jobs(owner_id,status,updated_at);
CREATE TABLE rag_chunks (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, record_id TEXT NOT NULL,
 version INTEGER NOT NULL, ordinal INTEGER NOT NULL, start_offset INTEGER NOT NULL,
 end_offset INTEGER NOT NULL, model TEXT NOT NULL, indexed_at TEXT NOT NULL
);
CREATE INDEX rag_chunks_record ON rag_chunks(owner_id,record_id,version);
CREATE TABLE record_evidence (
 record_id TEXT NOT NULL, version INTEGER NOT NULL, source_id TEXT NOT NULL, source_version INTEGER NOT NULL,
 PRIMARY KEY(record_id,version,source_id),
 FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE
);
CREATE TABLE model_usage (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL,
 operation TEXT NOT NULL, input_chars INTEGER NOT NULL, timestamp TEXT NOT NULL
);
CREATE INDEX model_usage_owner_date ON model_usage(owner_id,timestamp);
CREATE TRIGGER records_rag_ai AFTER INSERT ON records BEGIN
 INSERT INTO rag_jobs(owner_id,record_id,version,updated_at) VALUES(new.owner_id,new.id,new.version,new.updated_at)
 ON CONFLICT(owner_id,record_id) DO UPDATE SET version=excluded.version,status='pending',error_code=NULL,updated_at=excluded.updated_at;
END;
CREATE TRIGGER records_rag_au AFTER UPDATE ON records WHEN old.version!=new.version BEGIN
 INSERT INTO rag_jobs(owner_id,record_id,version,updated_at) VALUES(new.owner_id,new.id,new.version,new.updated_at)
 ON CONFLICT(owner_id,record_id) DO UPDATE SET version=excluded.version,status='pending',error_code=NULL,updated_at=excluded.updated_at;
END;
CREATE TRIGGER records_rag_ad AFTER DELETE ON records BEGIN
 INSERT INTO rag_jobs(owner_id,record_id,version,status,updated_at) VALUES(old.owner_id,old.id,old.version+1,'pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(owner_id,record_id) DO UPDATE SET version=excluded.version,status='pending',updated_at=excluded.updated_at;
END;
INSERT INTO rag_jobs(owner_id,record_id,version,updated_at) SELECT owner_id,id,version,updated_at FROM records;
