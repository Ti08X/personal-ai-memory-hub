// Collection-only entry point: actual upstream collectors, URL deduplication, cursors,
// fetch_runs and pg-boss jobs. Analysis jobs stay queued until models are configured.
import { assertFreeMode } from "./policy.ts";
import { sql, closeDb } from "@aihot/backend/db";
import { getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { registerSourceJobs } from "@aihot/backend/jobs/sources";
import { scheduleDueSources } from "@aihot/backend/sources/collect";
import { startHeartbeat } from "@aihot/backend/operations/heartbeat";
assertFreeMode();
const [unsafe] = await sql`SELECT count(*)::int AS count FROM sources WHERE kind<>'rss'`;
if (unsafe?.count) throw new Error("This worker supports free RSS sources only");
const boss = await getBoss();
await registerSourceJobs(boss);
const heartbeat = startHeartbeat("worker");
let running = false;
const schedule = async () => {
  if (running || process.env.COLLECT_ENABLED !== "true") return;
  running=true;
  try { await scheduleDueSources(); } catch { console.error("collection_schedule_failed"); } finally { running=false; }
};
await schedule();
const timer=setInterval(schedule,60000);
for (const signal of ["SIGTERM","SIGINT"] as const) process.once(signal, async()=>{
  clearInterval(timer);clearInterval(heartbeat);await stopBoss();await closeDb();process.exit(0);
});
console.log("Free RSS collection worker started; model workers disabled");
