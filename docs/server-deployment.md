# Server deployment and operations

The hosted service uses a self-owned Linux server, Node.js 24, SQLite WAL/FTS5, Qdrant and a dedicated background worker. The original Cloudflare entry remains for local tests and migration reference. Both runtimes share `src/app.ts`, Store, encryption, scopes, deduplication and version/conflict handling.

The production domain and `/mcp` / `/v1` contracts do not change when moving hosts. Supply API keys through private client settings. A repository URL alone does not provide access to the owner's data.

## Components

| Component | Responsibility |
|---|---|
| Existing reverse proxy | HTTPS, separate virtual host, forwards to loopback API |
| Node API | Dashboard, password/mandatory 2FA, scoped REST and remote MCP |
| SQLite WAL | Encrypted originals, versions, conflicts, auth, HMAC FTS, durable jobs |
| Qdrant | BGE M3 1024-dimensional vectors, tenant/collection/sensitivity filters |
| Node worker | Incremental indexing, source classification and evidence-based scope summaries |
| External model APIs | Existing SiliconFlow embedding/reranking and user-configured summary provider |
| Backup timer | Consistent online SQLite backup, integrity checks, checksum, retention |

This is a single-server personal deployment, not a horizontally replicated database. SQLite must stay on local disk; do not share its WAL files across machines. External AI clients use the authenticated API, never direct database access. No local LLM, Redis or second relational database is required.

## Initial provisioning

1. Inspect host memory, disk, listeners and existing services; back them up before changes. Install Docker and Compose from official sources if absent. Do not replace an existing site's proxy configuration.
2. Build the portable app locally with `npm ci` and `npm run build:server`. Review `server/Dockerfile`, `server/compose.yaml` and the strict `.dockerignore` allowlist.
3. Create `/opt/personal-memory-hub`, `/etc/personal-memory-hub`, and private data/backup directories under `/var/lib/personal-memory-hub`. API/worker run as UID 1000; data/backup mount directories must be writable by that UID and inaccessible to unrelated users.
4. Put the original encryption key in `/etc/personal-memory-hub/runtime.env` as `ENCRYPTION_KEY=...` using a private local editor or secret provisioning mechanism. Generate a private vector service key; set `QDRANT_API_KEY` in runtime.env and the same value as `QDRANT__SERVICE__API_KEY` in vector.env. Both env files must be mode 600. Never paste their contents into AI chats, terminal output, issues or source.
5. For an existing installation, freeze source writes and scheduled model jobs, then take a complete consistent encrypted backup. Preserve the same master key, current records, versions, raw batches, clients/policies, dashboard account/2FA, model settings, strategy and evidence tables. Do not switch using an incomplete or old snapshot.
6. `python3 scripts/restore-server.py PRIVATE_D1_BACKUP NEW_SQLITE_FILE` restores a new file without overwriting. The input manifest must include all supported persistent tables. Transfer that database privately to the data mount. Compare full-row digests and verify decryption with `server/check-migration.mjs` before starting the worker. The manifest/key must remain private.
7. For a genuinely new empty installation only, `scripts/bootstrap.mjs` creates private bootstrap materials. Initialize a fresh SQLite schema and import its bootstrap SQL locally; never bootstrap over an existing production database or replace an old encryption key.
8. Set PUBLIC_ORIGIN, loopback ports, image/version and domain paths for your own host in Compose/proxy configuration. Add a separate HTTPS virtual host from `server/nginx.conf`; install certificates through private files. Populate its trusted proxy IP include from the proxy vendor's official current ranges. Only trust forwarded IP headers from those ranges.
9. Start vectors and API, verify data and authentication, then start the worker. When using Cloudflare's free domain proxy, require strict HTTPS for this hostname; preserve unrelated zone settings. Switch DNS only after the origin is healthy. Application and vector ports must remain loopback-only.
10. Install and test the optional systemd backup unit/timer from server/. Docker restart policies recover existing services on boot. Configure an independent off-server backup destination if needed; the included timer only writes local backups.

The supplied Compose/proxy files document the hosted instance's paths and domain as an example. Self-hosters must replace the domain, HTTPS origin and host-specific paths. They do not contain private production data or credentials.

## Validation

```sh
npm run check
npm run test:server
```

The Node test harness creates disposable data and credentials, runs the shared HTTP/permission/crypto/import/strategy regression suite, and removes its temporary environment. The optional real-browser test needs its browser dependency configured and otherwise reports a skip.

`server/vector-check.mjs` creates a separate synthetic vector collection and verifies acknowledged writes, semantic queries, tenant isolation, sensitivity/collection filtering and deletion, then removes the collection. Run only as an explicit operator check using private runtime configuration.

`server/smoke.mjs` is an explicit public HTTPS write/read/dedup/conflict test using a disposable owner and short-lived synthetic credentials. It cleans only its own generated data. Do not run it on an interval or use real user records as test fixtures.

For production, run `scripts/verify-deployment.mjs` with private existing client files. It verifies assets, authentication, strategy write denial, actual MCP discovery and handoff; it does not log private response bodies. Indexing configured successfully is not full semantic coverage; check real queued/submitted/indexed/failed states.

## Routine updates

```sh
npm run deploy -- --host YOUR_SERVER --user ubuntu --ssh-key /private/server-key.pem
node scripts/verify-deployment.mjs --url https://YOUR_DOMAIN \
  --credential-dir /private/client-config-directory --output /private/live-check.json
```

The update script builds the app, triggers a server backup, keeps the previous image, and recreates API/worker. It does not replace the database, secrets, TLS, DNS or client permissions. It assumes initial provisioning has completed and the existing SSH host key is trusted. Change the deployment root/config for other installations as necessary. Do not run the old Cloudflare deploy command against the migrated production hostname.

## Backup and recovery

`server/backup.mjs` uses Node SQLite's online backup API rather than copying a live main file without its WAL. It checks integrity/foreign keys, writes a SHA-256 digest, and retains the most recent 30 copies. The example timer runs twice per day; these are local disk backups. Store the master key separately and configure off-server copies for server-loss recovery.

Vectors can be rebuilt from authorized originals. Password/TOTP and model credentials remain encrypted using the original master key. Ephemeral sessions are intentionally omitted in D1 export restores, so one fresh login is expected after migration; subsequent sessions retain their configured lifetime.

For application rollback, preserve the live database and use a schema-compatible previous image. Do not point DNS at an old frozen database after new server writes: that would make newer records unavailable. A full reverse migration requires a new write freeze, current snapshot, isolated restoration and verification before switching.

Technical references: [Node SQLite](https://nodejs.org/api/sqlite.html), [Qdrant local deployment](https://qdrant.tech/documentation/quickstart/), [Qdrant acknowledged writes](https://api.qdrant.tech/api-reference/points/upsert-points), [Cloudflare per-host SSL settings](https://developers.cloudflare.com/rules/configuration-rules/settings/#ssl).
