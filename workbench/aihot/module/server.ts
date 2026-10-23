import { readFileSync } from "node:fs";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { beijingDate, beijingMidnight } from "@aihot/contracts/time";
import { sql } from "@aihot/backend/db";
import { createSource, updateSource, fetchNow } from "@aihot/backend/admin/sources";
import type { ServerModule } from "@aihot/backend/modules";
import { Conflict } from "@aihot/backend/audit";
import { UnsupportedConfig } from "@aihot/backend/sources/config-keys";
import { assertFreeMode, sourceInput, sourceEdit } from "./policy.ts";

assertFreeMode();
const actor = "workbench-owner";
const token = readFileSync(process.env.WB_INTEL_TOKEN_FILE || "/run/secrets/workspace", "utf8").trim();
if (token.length < 32) throw new Error("Missing private workbench service credential");
const validToken = (value: unknown) => typeof value === "string" && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
const pageInput = (n: unknown, fallback: number, max: number) => Math.min(max, Math.max(0, Number.isSafeInteger(Number(n)) ? Number(n) : fallback));

export const workbench: ServerModule = {
  name: "workbench",
  http(app) {
    app.register(async (routes) => {
      routes.addHook("onRequest", async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        if (!validToken(req.headers["x-workbench-token"])) return reply.code(401).send({ error: "unauthorized" });
      });
      routes.setErrorHandler((error, _req, reply) => {
        const e = error as Error;
        const invalid = e.name === "ZodError" || e instanceof UnsupportedConfig;
        return reply.code(invalid ? 400 : e instanceof Conflict ? 409 : 500).send({ error: invalid ? "invalid_source" : e instanceof Conflict ? "source_conflict_refresh" : "collector_operation_failed" });
      });
      routes.get("/snapshot", async () => {
        const [sources, [totals], runs, articles, heartbeats, [paid]] = await Promise.all([
          sql`SELECT s.id,s.name,s.kind,s.enabled,s.health,s.interval_minutes,s.last_fetch_at,s.last_ok_at,s.last_error,s.next_fetch_at,s.updated_at,
            s.config->>'feedUrl' AS feed_url,(SELECT count(*)::int FROM articles a WHERE a.source_id=s.id) AS article_count
            FROM sources s ORDER BY s.name,s.id LIMIT 100`,
          sql`SELECT count(*)::int AS articles, count(*) FILTER (WHERE discovered_at>=${beijingMidnight(beijingDate(new Date()))})::int AS today FROM articles`,
          sql`SELECT r.id,r.source_id,s.name AS source_name,r.started_at,r.finished_at,r.status,r.found_count,r.new_count,r.error FROM fetch_runs r JOIN sources s ON s.id=r.source_id ORDER BY r.started_at DESC,r.id DESC LIMIT 30`,
          sql`SELECT a.id,a.source_id,s.name AS source_name,a.title,a.url,a.excerpt,a.published_at,a.discovered_at,a.processing_state FROM articles a JOIN sources s ON s.id=a.source_id ORDER BY a.discovered_at DESC,a.id DESC LIMIT 12`,
          sql`SELECT key,value,updated_at FROM settings WHERE key IN ('heartbeat.worker','heartbeat.api')`,
          sql`SELECT count(*)::int AS receipts FROM receipts`,
        ]);
        return { ok: true, collectedAt: new Date().toISOString(), mode: "free-rss", modelsEnabled: false, paidProvidersEnabled: false,
          upstream: process.env.AIHOT_RELEASE, totals: { ...totals, sources: sources.length, enabled: sources.filter(s=>s.enabled).length, healthy: sources.filter(s=>s.enabled && s.health==='ok').length, paidReceipts: paid?.receipts ?? 0 },
          sources, runs, articles, heartbeats };
      });
      routes.get<{Querystring:{q?:string;offset?:string;limit?:string}}>("/articles", async (req) => {
        const q = req.query.q?.trim().slice(0,150) || null;
        const offset = pageInput(req.query.offset,0,1000000), limit = Math.max(1,pageInput(req.query.limit,30,100));
        const pattern = q ? `%${q.replace(/[\\%_]/g,"\\$&")}%` : null;
        const [rows,[total]] = await Promise.all([
          sql`SELECT a.id,a.source_id,s.name AS source_name,a.title,a.url,a.excerpt,a.published_at,a.discovered_at,a.processing_state
            FROM articles a JOIN sources s ON s.id=a.source_id WHERE (${pattern}::text IS NULL OR a.title ILIKE ${pattern} OR a.excerpt ILIKE ${pattern}) ORDER BY a.discovered_at DESC,a.id DESC LIMIT ${limit} OFFSET ${offset}`,
          sql`SELECT count(*)::int AS count FROM articles a WHERE (${pattern}::text IS NULL OR a.title ILIKE ${pattern} OR a.excerpt ILIKE ${pattern})`,
        ]);
        return { rows, total: total?.count ?? 0, offset, limit };
      });
      routes.post("/sources", async (req, reply) => {
        const b = sourceInput.parse(req.body);
        const result = await createSource({ id: "rss-"+randomBytes(8).toString("hex"), name: b.name, kind: "rss", config: { feedUrl: b.feedUrl, _aihot: { initialBackfillLimit: 8 } }, interval_minutes:b.intervalMinutes, site_fulltext:false, syndicate_fulltext:false },actor);
        return reply.code(result.created ? 201 : 409).send(result);
      });
      routes.patch<{Params:{id:string}}>("/sources/:id", async (req, reply) => {
        const b = sourceEdit.parse(req.body);
        const [source] = await sql`SELECT kind,config FROM sources WHERE id=${req.params.id}`;
        if (!source) return reply.code(404).send({error:"not_found"});
        if (source.kind !== "rss") return reply.code(400).send({error:"free_rss_only"});
        const patch: Record<string,unknown> = {};
        if (b.name !== undefined) patch.name=b.name;
        if (b.enabled !== undefined) patch.enabled=b.enabled;
        if (b.intervalMinutes !== undefined) patch.interval_minutes=b.intervalMinutes;
        if (b.feedUrl !== undefined) patch.config={...source.config, feedUrl:b.feedUrl};
        await updateSource(req.params.id,{patch,version:b.version},actor);
        return {ok:true};
      });
      routes.post<{Params:{id:string}}>("/sources/:id/fetch", async (req, reply) => {
        const [source] = await sql`SELECT kind,enabled FROM sources WHERE id=${req.params.id}`;
        if (!source) return reply.code(404).send({error:"not_found"});
        if (source.kind !== "rss" || !source.enabled) return reply.code(400).send({error:"source_paused_or_not_free"});
        return reply.code(202).send(await fetchNow(req.params.id,actor));
      });
    }, {prefix:"/internal/workbench"});
  },
};
