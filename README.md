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

## Permission levels

| Level | Data sensitivity | Access includes |
| --- | --- | --- |
| L0 | Public | L0 records |
| L1 | Normal | L0–L1 records |
| L2 | Sensitive | L0–L2 records, with the matching sensitive permission |
| L3 | Restricted | L0–L3 records, with the matching sensitive permission |

Read and write ceilings are independent. The API key must also have the needed operation scope and collection access. None of the levels grants admin access or makes it appropriate to store passwords, cookies, 2FA codes, or other credentials as memories.

## OpenClaw

Clone this repository and install the plugin from its local directory:

```bash
git clone https://github.com/Ti08X/personal-ai-memory-hub.git
cd personal-ai-memory-hub
openclaw plugins install ./integrations/openclaw-memory
```

Follow [`integrations/openclaw-memory/README.md`](integrations/openclaw-memory/README.md) to add the client key through OpenClaw’s private configuration. The Skill instructions are in [`integrations/skills/personal-ai-memory-hub/SKILL.md`](integrations/skills/personal-ai-memory-hub/SKILL.md). Give the AI this repository URL as its implementation and usage reference, then enter its own API key in the private connection settings.

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
