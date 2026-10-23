import { z } from "zod";

// This deployment deliberately has no paid-provider configuration surface.
export function assertFreeMode() {
  if (process.env.MODEL_CALLS_ENABLED !== "false") throw new Error("Collection-only mode requires models disabled");
  for (const key of ["SOCIALDATA_API_KEY", "DAJIALA_KEY", "JINA_API_KEY", "LLM_API_KEY", "EMBEDDING_API_KEY", "DASHSCOPE_API_KEY"])
    if (process.env[key]) throw new Error("Paid provider credentials are not accepted in collection-only mode");
}
export const feedUrl = z.string().url().max(1500).refine((value) => {
  const u = new URL(value);
  return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash && u.hostname !== "r.jina.ai";
}, "使用无凭据、无查询参数的公开 RSS/Atom 地址");
export const sourceInput = z.object({
  name: z.string().trim().min(1).max(100),
  feedUrl,
  intervalMinutes: z.number().int().min(30).max(1440).default(120),
}).strict();
export const sourceEdit = sourceInput.partial().extend({
  version: z.string().datetime(), enabled: z.boolean().optional(),
}).strict();
