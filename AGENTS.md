# Project instructions

Production uses Node.js 24, SQLite WAL/FTS5 and Qdrant on a self-owned server. Read docs/server-deployment.md. REST/MCP and the private dashboard share src/app.ts and Store; server runtime adapters live in server/. src/index.ts remains the legacy Cloudflare/local test entry. Never deploy legacy wrangler.jsonc to the owner's production domain or re-enable old cron jobs.

Preserve owner/scopes/sensitivity/collection filters, source versions, encryption, deduplication and conflict handling. Strategy editing is owner-dashboard-only, with password/2FA, same-origin and CSRF checks. AI keys never gain strategic editing or administrator rights implicitly.

Run npm run check and npm run test:server with isolated synthetic data. Never print or commit live credentials, database files, archives, personal data or encrypted production backups. Keep production imports and tests explicitly scoped; no official private chat harvesting.
