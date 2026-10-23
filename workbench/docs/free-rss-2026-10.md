# Free RSS collection — 2026-10-23

The workspace now reads real collection data from a pinned [upstream engine](../aihot/README.md), rather than showing Hindsight ingestion as if it were external collection. Free RSS/Atom sources are the only enabled source type. Model processing, paid collectors, reports, notifications and automatic personal-memory distribution remain off or pending configuration.

## Live acceptance

Checked on 2026-10-23 at 14:40 UTC:

- 18 configured/enabled sources, all 18 successfully collected; 144 raw articles and 144 unique URL identities.
- First import is capped at 8 items per source, not a full historical archive. Source publication dates in this bounded batch range from 2026-01-10 to 2026-10-23.
- Repeat collection of Berkeley AI Research found 10 feed entries and inserted **0** additional articles; the first pass inserted 8.
- Re-fetched public feeds for OpenAI News, Google DeepMind and Berkeley AI Research: 3 stored articles per source, **9/9 original URLs, titles and publication times matched**. This is a sample comparison, not a full-text verification of every item.
- Article pagination returned 20 items on each of the first two pages, with no overlapping IDs; total 144.
- Collector paid receipts **0**, models disabled, paid providers disabled; worker heartbeat fresh after restart.
- Collector backup restored into a separate temporary database: 18 sources / 144 articles / 0 receipts. The temporary restore DB was then removed. Original collection records persisted through API/worker restart.
- Existing business data, credentials and authentication preserved. Both public unauthenticated access and upstream private routes without the service token return **401**. New API port is loopback-only; collector PostgreSQL publishes no host port.
- Deployed UI assets match the tested source hashes. Private runtime configuration and original reference artwork remain in the existing deployment.

Raw collection is stored separately from personal memory. In the UI, AI processing is explicitly “待配置”; raw database storage is not described as completed summarization, vector indexing or memory distribution. Fetch records show source-provided failures and actual new-item counts. The initial overview displayed 6 source rows; the subsequent [readability update](readability-2026-10.md) uses 4 source cards and a full-list management dialog; fetch history shows the latest 30 attempts.

## Verification

- Workspace TypeScript and JavaScript syntax checks passed.
- Workspace API/bridge: **9 tests passed**, including scoped routes, same-origin writes, private service-token handling and timeout/error behavior.
- Existing server regression: **97 passed, 2 environment skips**, no failures.
- Synthetic actual-mode browser checks: 8 pages × desktop/mobile, no horizontal overflow or script errors; source editing (including Enter to save) reaches the backend; raw article browsing works. Existing reference geometry checks remain within 3 px and the overview checks within 2 px.
- Upstream typecheck and web build passed; web browser tests **60 passed**. Standalone checks **230 passed** (overlap with the main suite; do not add these as unique coverage).
- Full upstream + module database suite completed **938 tests: 924 passed, 14 initially failed because the backend-only image omitted the SSR test build**. After adding the build to the isolated checks image and a writable temporary data path, all **14 affected tests passed on rerun**. This was a targeted rerun, not a second full 938-test run.
- New private-module checks cover unauthenticated denial, rejection of paid source kinds/config injection, source creation, pause behavior, stale-version conflict, article limits and zero paid receipts.
- The full suite uses a separate `_test` database, local fake providers, synthetic auth, one file at a time and a 1 CPU/768 MiB cap. Production collection/model flags are independent. Early oversized/undersized test-pool attempts were stopped; the final test profile avoids contention with production.

The upstream public website is not deployed, so its whole-public-site `scripts/smoke.ts` is not a production acceptance target here. This release checks the existing private workspace routes instead. Authenticated production browser automation was unavailable in the session; live acceptance used protected-boundary HTTP checks, internal API readback, source re-fetch comparison and deployed-asset hashes. UI browser tests used synthetic fixtures, not a production login.

## Public screenshots

These are synthetic API-fixture screenshots, **not production captures**. No private archives, production databases, runtime secrets, owner identity, infrastructure addresses or original private reference images are included.

![Free collection — synthetic desktop](screenshots/intel-live-desktop.png)

[Mobile preview](screenshots/intel-live-mobile.png)
