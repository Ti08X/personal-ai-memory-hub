# Personal AI Memory Hub

A self-hostable personal context and long-term memory service. It provides a private dashboard, REST API, remote MCP endpoint, searchable conversation archive, structured memories, social-account notes, knowledge documents, and an optional OpenClaw integration. The service stores and retrieves information; it does not generate chat answers.

## Connect an AI to the hosted Hub

The project owner’s hosted instance is available at:

- Dashboard: <https://pw.zgatri.com/dashboard>
- MCP (Streamable HTTP): <https://pw.zgatri.com/mcp>
- REST API: <https://pw.zgatri.com/v1>

Create a separate client API key in the dashboard for each AI. Set its read and write levels, allowed collections, and operations to match that client’s job. L3 can read or write records at every sensitivity level, including restricted records; it does not grant administrator access. Use L3 only for a client you fully trust.

For an MCP client, configure the endpoint and put the key in that client’s private secret or connection settings:

```json
{
  "url": "https://pw.zgatri.com/mcp",
  "transport": "streamable-http",
  "headers": {"Authorization": "Bearer YOUR_API_KEY"}
}
```

Never place a real API key in this repository, a GitHub issue, a public chat, or a screenshot. The repository contains source code and setup instructions only; it does not contain the owner’s conversations, database, or credentials.

## Categorization and overview

The source includes personal/development topic classification, visual coverage and daily intake metrics, and a versioned evidence-based overview of personal context, projects, current progress and next actions. AI clients start with `get_handoff` / `get_overview`, then retrieve detailed sections and original sources. Background organization reuses the configured summary provider and skips unchanged sources. See [the architecture and upgrade guide](docs/memory-overview.md).

## Owner-published strategy

The owner drafts and publishes a hierarchy of overall strategy, stage strategy and monthly goals in the password/2FA dashboard. The published strategy is the highest-priority source for personal goals and task planning. Agents read it first in `get_handoff`, then personal context and observed execution progress. `get_strategy` is read-only; even L3 or administrator Bearer keys cannot edit or publish goals. Drafts remain private. See [strategy, permissions and usage](docs/strategy.md). The hosted instance includes this feature; published goals remain empty until the owner supplies and publishes them.

## Permission levels

| Level | Data sensitivity | Access includes |
| --- | --- | --- |
| L0 | Public | L0 records |
| L1 | Normal | L0–L1 records |
| L2 | Sensitive | L0–L2 records, with the matching sensitive permission |
| L3 | Restricted | L0–L3 records, with the matching sensitive permission |

Read and write ceilings are independent. The API key must also have the needed operation scope and collection access. None of the levels grants admin access or makes it appropriate to store passwords, cookies, 2FA codes, or other credentials as memories.

## OpenClaw

The Hook plugin is optional; it adds per-turn context recall and capture. For history backfill plus daily scheduled uploads, follow the [daily sync guide](integrations/openclaw-memory/daily-sync.md); the plugin is not required for that workflow. If you do install the plugin, keep `autoArchive` and `autoSummary` disabled for daily-only archiving. To install the optional plugin:

```bash
git clone https://github.com/Ti08X/personal-ai-memory-hub.git
cd personal-ai-memory-hub
openclaw plugins install ./integrations/openclaw-memory
```

Follow [`integrations/openclaw-memory/README.md`](integrations/openclaw-memory/README.md) to add the client key through OpenClaw’s private configuration. For one-time history backfill followed by daily scheduled chat archiving, see the [OpenClaw daily sync guide](integrations/openclaw-memory/daily-sync.md). The Skill instructions are in [`integrations/skills/personal-ai-memory-hub/SKILL.md`](integrations/skills/personal-ai-memory-hub/SKILL.md). Give the AI this repository URL as its implementation and usage reference, then enter its own API key in the private connection settings.

## What the service can collect

An AI client can submit the visible conversation messages it is authorized to access, and a user can import exported files through the dashboard or API. Connecting MCP does not grant access to private chat histories held by other AI platforms. Those histories require a supported client submission or a user-provided export. The dashboard shows source and provenance so imported content can be traced.

## Self-host on Cloudflare

Requirements: Node.js 22.18 or later, a Cloudflare account, a D1 database, and (if semantic search is enabled) a Vectorize index. Replace the D1 placeholder and Vectorize index name in `wrangler.jsonc` with resources in your own account, and configure secrets through Wrangler or Cloudflare settings. Never commit `.dev.vars` or real secrets.

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

For deployment, create your own D1 and Vectorize resources, set the database and index bindings, set the encryption secret, apply migrations, then deploy with Wrangler. RAG and external model calls are optional; configure provider keys in the authenticated dashboard or as server secrets. Provider pricing and rate limits apply. This repository does not include or reuse the hosted owner’s Cloudflare resources.

## Main interfaces

- Web dashboard: conversation archive, memories, profile, projects and plans, social accounts, knowledge files, search, conflicts, client keys, and model settings.
- REST API: documented in [`docs/api.md`](docs/api.md).
- Remote MCP: Streamable HTTP; client tools are constrained by the API key’s scopes, levels, and collections.
- OpenClaw plugin and portable Skill: under [`integrations/`](integrations/).

## Privacy and security

Records are encrypted at rest by the Worker application. API keys are shown once when created and stored as hashes. Use a distinct revocable key for each client. Keep client keys in private configuration and rotate them if exposed. The public repository is a source distribution, not a backup of the owner’s personal data.

Dashboard login requires the account password and a second factor. A successful login keeps the same browser signed in for up to 7 days using a Secure, HttpOnly, same-site cookie; refreshing the page does not end the session. Manual logout, password changes, account revocation, or the 7-day expiry end it sooner. Passwords and authenticator codes are not stored in browser storage.
