-- Scheduled indexing looks up active work across owners. The existing index
-- starts with owner_id and cannot seek by status alone.
CREATE INDEX rag_jobs_status_owner ON rag_jobs(status,owner_id);
