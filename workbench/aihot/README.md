# Free RSS collection / 免费资讯采集

The existing private workspace is the frontend. The collection engine is a pinned MIT-licensed derivative of [KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT), commit `b3998dc6fc138eb9659f33f55eb38c1c716f0d57`. Its collectors, parsing, URL identities, incremental cursors, PostgreSQL schema, migrations, fetch history and pg-boss queues are reused directly. The upstream product name and logo are not used as this workspace's brand.

首版只启用使用者确认的上游 18 个公开 RSS/Atom 示范信源，不接入作者私人信源库。模型、X/公众号付费接口、Jina、消息推送均关闭。免费指没有新增采集接口费，服务器、存储和带宽仍占资源。媒体付费正文不包含在 RSS 授权中；仅显示摘要和原文链接。

## Deployment

Use Node >=24.22.1 to prepare the engine outside this public repository:

```sh
node workbench/aihot/prepare.mjs /private/new-collector-engine
```

Copy the prepared engine into `/opt/pw-intel/engine`, and `compose.yml` into `/opt/pw-intel/compose.yml`. Keep the generated runtime configuration on the host:

```sh
sudo python3 workbench/aihot/init-config.py --directory /opt/pw-intel --site-url https://workspace.example.com
cd /opt/pw-intel
sudo docker compose build api
sudo docker compose up -d db
sudo docker compose up -d api
```

The setup container applies upstream migrations and seeds demo sources. `COLLECT_ENABLED=false` keeps collection off during acceptance. After confirming sources, set only this flag to `true` in the private `.env`, then `sudo docker compose up -d worker`. Keep `MODEL_CALLS_ENABLED=false`. No model workers are started: the module's collection-only worker schedules the upstream collectors, body extraction and deduplication. Analysis jobs remain pending for later model configuration, rather than becoming fake successful summaries or repeated model failures. Automatic source-interval adaptation and publication/reporting jobs are not started in this phase.

The API publishes port **8901 on loopback only**, and the independent PostgreSQL 17 database publishes no host port. Do not deploy the upstream public web/Caddy services. Keep the existing authenticated HTTPS reverse proxy and all existing workspace credentials.

Deploy `workbench/server.mjs`, `intel.mjs` and `telemetry.mjs` together. Set the API's non-secret runtime variables if paths differ:

- `WB_INTEL_URL=http://127.0.0.1:8901`
- `WB_INTEL_TOKEN_FILE=/opt/pw-intel/workspace-token`
- Existing `PUBLIC_ORIGIN`, SQLite/key paths and TLS certificate path must retain their deployment-specific values.

The server API must be able to read the private token; do not loosen it to world-readable permissions. The token is supplied server-to-server only; the browser uses existing same-origin `/api/wb/intel/*` routes. Writes additionally require the exact allowed Origin. Upstream routes require the private service token. The bridge allows only snapshot, article listing, RSS source creation/edit/pause/resume and queued fetches; it cannot proxy arbitrary admin paths or remote origins. Feed requests retain upstream SSRF/private-network protection.

## Data and limits

- Independent collector DB and Docker volumes; no change to existing workspace/Hindsight databases or their client credentials.
- Initial backfill is limited to 8 articles per source; this is not an exhaustive historical archive. Subsequent fetches use upstream incremental collection and URL deduplication.
- Source snapshot shows up to 100 sources; first phase has 18. Run history shows the latest 30 attempts. Articles have server search and 20-row UI pagination (API maximum 100).
- Raw articles preserve source, original URL, source-provided title/excerpt, publication time when available and discovered time. No fabricated publication dates, translations, quality scores or AI summaries.
- Failed or blocked feeds remain visible with failure details. A source being configured is not proof that it fetched successfully. API failures clear the frontend snapshot instead of falling back to demo data.
- No automatic ingestion into personal memory, embeddings or outbound notifications. AI processing and memory distribution remain pending.

## Checks and operations

```sh
npm run test:workbench:api
npm run test:workbench:live
```

Inside the prepared engine, run upstream typecheck, isolated test DB checks (database name ending `_test`/`_ci`), standalone policy tests and relevant web checks. The prepared checkout stages its public module/config files so upstream architecture checks inspect them too; it makes no upstream commit or push. A separate checks image adds Git and the upstream SSR build for those checks; the production image excludes Git metadata.

On a small production host, use the opt-in isolated check service instead of unbounded test concurrency:

```sh
sudo docker compose --profile checks build checks
sudo docker compose --profile checks run --rm --no-deps -T checks
```

This runs one test file at a time, caps its container at 1 CPU/768 MiB, uses a separate `_test` database, synthetic auth configuration, and no production data volume or bridge token. The test connection pool remains 10: the upstream concurrent-creation test deliberately reserves five connections and needs a sixth connection to observe the locks. Its collection/model flags are enabled only for the upstream local provider stubs; this does not change production flags. Paid-provider tests use upstream local stubs; never run them against the collection database. Keep production paid switches off. The deployment image includes development dependencies to support isolated verification; the upstream public web build is unnecessary for serving this workspace.

Back up the existing UI/API before deployment. For collector backups, use `pg_dump` internally with host-generated credentials, save under a private root-owned directory, and verify restoration into a separate test DB. Never commit dumps, production screenshots, raw collected datasets, tokens, `.env`, or private configuration. Rollback stops the new worker/API and restores previous workspace code, retaining the collection volumes for recovery; do not delete existing data volumes.
