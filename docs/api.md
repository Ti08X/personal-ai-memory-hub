# REST / MCP 使用协议

## 自动记忆运行报告（2026-10-14 已发布）

`GET /v1/integrations/activity?limit=50`：需要 memory:read。AI Key 只查看本客户端事件；网页管理员可以查看同 owner 各客户端。返回 events、scope、coverage 与不含原始 owner ID 的 owner_ref，插件用于将离线队列绑定同一账户。limit 为 1–100；本接口是近期运行记录，不是聊天档案全量导出。

`POST /v1/integrations/activity`：需要 memory:write，以下是合成示例：

```json
{"authorized":true,"event_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","timestamp":"2026-10-14T12:00:00+08:00","plugin_version":"0.1.0","phase":"archive","state":"success","code":"none","session_ref":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","counts":{"archived":2,"verified":2,"pending":0}}
```

phase 为 recall/archive/summary/sync；state 为 success/pending/conflict/failed/skipped；counts 可包含 read/archived/verified/pending/derived。event_id 和 session_ref 是散列标识；后者允许空字符串。code 仅接受固定错误分类，不接收异常正文。严格拒绝聊天正文、Key 或其他额外字段。相同事件去重，改变已存在事件内容返回 409；保存到现有审计表，无数据库迁移。

报告是客户端提交的元数据，不能证明所有会话都已采集，离线未上传的状态也无法在云端实时显示。标准 MCP 工具仍为已有九个；插件使用 REST，并提供客户端侧 pmh_search/pmh_get 工具，不将此运行报告冒充新的云端记忆。

所有 `/v1` 与 `/mcp` 请求要求 `Authorization: Bearer <客户端凭证>`。凭证由本地程序读取，不在聊天里粘贴。POST/DELETE JSON 要带 `Content-Type: application/json`。MCP 标准 Streamable HTTP 在 `/mcp`，HTTP transport SDK 负责 initialize 和协议协商；本地桥接负责 stdio 客户端兼容。

V1 MCP 五个工具的实际 JSON Schema 曾从部署服务发现并保存在 [tool-schemas.json](tool-schemas.json)。五个 REST 核心操作的机器可读描述：[openapi.json](openapi.json)。其他管理 REST 操作见下面。

## 保存与更新

POST `/v1/memories` 的完整例子见 [example-memory.json](example-memory.json)。必填 authorized=true、source_platform、source_kind、timestamp（带时区 ISO 8601）、text。record_type 默认 memory；允许 memory/profile/event/context/summary，V2 增加 project/task。source_kind 为 direct_user/assistant_summary/imported_document/test。客户端以实际来源填写，不要把总结假装成用户原话。

稳定事实使用 logical_key；profile 必须提供它。没有 key 时提供稳定 source_record_id 和 session_id。如果二者都缺失，只按同一类型/来源/会话的相同内容去重。data 是 JSON 对象，tags 是数组，confidence 为 0–1，V2 sensitivity 为 public/normal/sensitive/restricted，旧 normal/sensitive 保持原级别。timestamp 进入近期窗口，server 的 created_at/updated_at 独立保存。

成功状态 201：

```json
{"id":"rec_...","version":1,"deduplicated":false}
```

读取 GET `/v1/records/rec_...` 获取当前 version 和 payload；更新时重发同一个 key/ID 并带 expected_version。冲突状态 409：

```json
{"error":"memory_conflict","details":{"id":"rec_...","current_version":1,"conflict_id":"con_..."}}
```

GET `/v1/conflicts` 查看 pending 候选。用户选定内容后，携带最新 expected_version 和 conflict_id 保存候选；候选内容及敏感标记必须一致。也可以基于用户选择提交另一份新内容；未采用候选会继续保留。GET `/v1/records/{id}/history` 返回旧版本，仍受敏感读取权限限制。

## 画像、近期和检索

- GET `/v1/profile` 返回 `fields` 和带来源记录。每个 logical_key 值使用 data 或 text，最多最近 200 项。
- GET `/v1/context?since=ISO_TIMESTAMP&limit=20&session_id=...&source_platform=...&include_conversation=true`。参数均可选，默认近 7 天、20 条、不包含 message；最多 50 条。
- GET `/v1/search?query=中文词组&record_type=message&limit=20&cursor=0`。类型筛选可选，query 至少两个规范化字符。按 next_cursor 翻页，包括空结果但 next_cursor 非空的情况。只做完整子串匹配，没有向量检索、拼音/同义词推断或问答生成。
- GET `/v1/export?cursor=...&limit=50`。按 record ID 分页导出当前可见记录；下一页使用返回的 next_cursor。原始批次与历史另取，不能把 current export 当作完整数据库备份。

返回记录包含 id、类型、来源平台/分类、session_id、source_record_id、logical_key、原时间及创建/更新时间、client_id、敏感标记、version 和 payload。索引、凭证 hash、owner_id 和加密正文不通过普通记录接口返回。

## 原始对话增量导入

POST `/v1/conversations/import`，例子见 [example-conversation.json](example-conversation.json)。必填 authorized=true、source_platform、session_id、completeness、messages。

- completeness：full/partial/summary，描述提供材料的完整性。summary 永远不能当原始对话。
- messages：1–10 条，每条稳定 id、role、原 timestamp、content，可带 raw 原始 JSON、sensitivity、expected_version、conflict_id（选择消息候选时）。
- title 与 raw_metadata 可选。raw_metadata/raw 是恢复原始结构的依据，系统不会凭空补出未提交的消息。
- 单批最大请求 256 KiB，单记录检索片段最多 16,000 个（超过返回 search_index_too_large，需分拆），凭证类内容拒绝；长数据使用 CLI 分批。ZIP 导入只读取 conversations.json，不上传其他 ZIP 文件。

成功 201 返回 conversation_id、batch_id、逐消息 id/version/deduplicated 或 conflict 信息及 conflicts 数量。**HTTP 201 不代表每条都写入当前版本**，必须检查 conflicts。存在冲突时原始批次仍被保存，原记录保持原值，候选待用户选择。整个批次不是一个事务，网络/资源中断前可能已经保存部分消息，可以重试。

GET `/v1/conversations/archive?source_platform=...&session_id=...` 返回原始导入批次。批次可能混合敏感/普通材料，统一要求 memory:read+sensitive:read。管理员删除会话：DELETE `/v1/conversations`，JSON `{ "authorized": true, "source_platform": "...", "session_id": "..." }`，不可恢复，详见安全文档。

## 客户端管理

GET `/v1/clients`（admin）列出客户端元数据和 scopes，不返回 token。

POST `/v1/clients`（admin）：`{"name":"new-client","scopes":["memory:read"],"expires_days":30}`。返回 201，含 ID、一次性 token 和 expires_at。应直接写私有文件，避免终端/聊天记录；推荐 CLI mint。

DELETE `/v1/clients/{id}`（admin）：JSON `{"authorized":true}`；立刻撤销该 owner 下的凭证。不能管理别人的 owner。

错误结果始终不回显提交的秘密。常见状态：400 参数、401 凭证、403 scope/Origin、404 不存在或不可见、409 冲突、413 超限、415 内容类型、422 像凭证的内容、429 限流、503 密钥配置/解密不可用。内部异常只返回 internal_error，不输出堆栈或正文。

## 管理界面与列表

- GET `/v1/dashboard`：当前 owner/scope 可见的汇总、平台计数、最近日期与同步覆盖说明。
- GET `/v1/records`：支持 source_platform/session_id/record_type/since/until/exclude_messages/order（asc 或 desc）；limit 1–50，cursor 数字偏移，返回 next_cursor。
- GET `/v1/conversations`：支持来源/时间筛选，limit 1–50，cursor 分页；计数只含可见消息。无 sensitive:read 时不返回可能混有敏感信息的原标题。
- POST `/v1/conflicts/{id}/dismiss`：authorized=true 和 expected_version 必填；检查当前版本后标记 rejected，保留候选。需要 memory:write，敏感记录另需 sensitive:write。

GET `/dashboard` 提供公开登录壳。POST `/ui/session` 使用 Bearer 和准确同源 Origin，返回短期会话 Cookie 与 CSRF token；GET `/ui/session` 恢复会话；DELETE `/ui/session` 要求同源和 X-CSRF-Token，并使会话不可重放。`/ui/api/*` 映射相同的 `/v1/*` 路由，使用有效会话，写操作另查 Origin/CSRF。标准 REST/MCP 不接受 Cookie。详见 [dashboard.md](dashboard.md)。

2026-10-12：`GET /v1/records` 和 search_memory / `GET /v1/search` 可选 collection=accounts/knowledge/memories，未指定则包含所有允许记录。记录增加 citation 字段（ID、版本与来源），文件行号在 payload.data。集合只是稳定字段约定，不扩大权限。详见 [digital-context.md](digital-context.md)。

## V2 新接口（0.4.0 已部署）

完整工具、REST、权限和字段说明见 [rag-v2.md](rag-v2.md)。`tool-schemas.json` 与 `openapi.json` 是 V1 部署快照，不包含 V2。search_memory 支持 mode=keyword/semantic/hybrid 与 rerank；collection 增加 chats/projects；REST 参数相同。MCP 新增 get_handoff/list_social_accounts/save_social_account/generate_summary。客户端 POST 可附 policy，续期 POST /v1/clients/{id}/renew。概要 evidence 是原记录 {id,version} 数组；save_memory 可带同样 evidence，自动继承敏感级别和来源可见性。已存在记录需要读权限才能更新或识别同 ID 的去重；只写 Key 适合新记录，不承诺可对其不可读旧记录更新。

模型设置是网页专用管理接口，GET/POST /ui/api/model-settings 与 POST /ui/api/model-settings/models，不对 /v1 或 MCP 暴露密钥配置。GET 只有非秘密元数据；参见 rag-v2.md。

2026-10-14：现有 POST /v1/clients 返回的 token 即 API Key；无需授权文件，MCP/REST 共用 Authorization: Bearer。新客户端使用独立 scope 与 policy，不能超过管理身份的上限；原 Key 只返回一次，GET /v1/clients 不返回它。网页对应 /ui/api/clients 的同源会话与 CSRF 保持不变。本地新增一次性复制、OpenClaw 配置与使用规则入口，完整 URL/Key 接入见 [接入说明](../public/openclaw-quickstart.md)。
