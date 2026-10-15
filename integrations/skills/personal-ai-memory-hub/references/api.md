# 调用与错误

Python 3 标准库脚本：读 check/handoff/profile/context/search/get/accounts；写 save/import/save-account/summary。写 JSON 从标准输入读取，正文/Key 不作为命令参数。输出 JSON 的 ok、operation；成功 data，失败 error。非零退出码是失败、冲突或未完成校验。

| MCP | REST / 脚本 |
| --- | --- |
| get_handoff / get_profile | GET /v1/handoff、/profile；handoff、profile |
| get_context | GET /v1/context；context --limit 20，可加 --since/--session-id/--include-conversation |
| search_memory | GET /v1/search；search --query "主题" --mode hybrid，可加 --collection/--record-type/--cursor/--max-pages/--no-rerank |
| list_social_accounts | GET /v1/social-accounts；accounts |
| 无单条 ID 读取 MCP 工具 | GET /v1/records/{id}；get --record-id rec_...，或核对 MCP 搜索原文的同一 ID |

搜索默认每页 10 条、关键词最多三页，空页继续。返回 complete/next_cursor；语义/混合是候选而非全量扫描。搜索和近期资料默认为短文本，truncated=true 时回读原文；命中可能在结构化字段里。search 不设日期边界，覆盖 Key 允许的旧资料。

## 写入

```bash
python3 "{baseDir}/scripts/hub_client.py" save < authorized-memory.json
python3 "{baseDir}/scripts/hub_client.py" import < authorized-conversation.json
```

save JSON 必填 authorized=true、source_platform、source_kind、timestamp（原发生时间、带时区）、text。record_type 可为 memory/profile/event/context/summary/project/task；sensitivity 为 public/normal/sensitive/restricted。profile 必须有 logical_key；稳定事实共用 logical_key，无 key 时给 source_record_id，必要时 session_id。

```json
{"authorized":true,"record_type":"task","logical_key":"projects.example.next-step","source_platform":"openclaw","source_kind":"direct_user","timestamp":"2026-10-14T12:00:00+08:00","title":"获授权下一步","text":"替换为用户实际决定的任务。","sensitivity":"sensitive"}
```

示例不是用户事实。新建不编造 expected_version；更新同一 key 前检索并回读，提交当前 version。资料整理标 assistant_summary，附 evidence:[{id,version}]；继承证据最高敏感度。

import 必填 authorized=true、source_platform、session_id、completeness、messages（1–10）；每条 id、role（只 user/assistant）、timestamp、content、sensitivity，不传内部 raw/tool/system 数据。长消息分段保留原 ID 和关联，重试复用 ID。

逐项判断返回 messages，HTTP 201 不代表全部保存。脚本对 conflicts>0 返回 memory_conflict 和 receipt，非冲突记录回读校验；失败可能发生在已保存之后，查看 persisted/receipt 再决定重试。persisted=unknown 表示写入响应丢失/异常或导入中途拒绝，按稳定 ID 查询，不能当作全部未保存。

save-account 对应 save_social_account，要求 record_type=profile、logical_key=accounts.<稳定账号ID>，只存链接、用途、备注。

summary 对应 generate_summary：authorized=true、evidence:[{id,version}]，可含 logical_key（默认 handoff.current）和 expected_version。外部模型可能计费，不作为日常查询自动步骤。

## 错误判断

| 返回 | 处理 |
| --- | --- |
| missing_api_key / invalid_api_key_format / authentication_required / invalid_or_expired_token | 尚未认证，停止并报告配置问题 |
| insufficient_scope / record_policy_denied | 权限不足，不提高权限 |
| model_provider_rate_limit / degraded | 供应商临时限流或检索降级，核对实际模式，关键词仍可用；Hub 不设模型调用次数额度 |
| memory_conflict / conflict_version_changed | 保留候选，报告差异，读最新版本 |
| write_verification_failed | 已提交但没完成回读，可能已保存，核查收据 |
| invalid_response / network_error / response_too_large | 无可用成功结果，不推断不存在资料 |
| ok=true、records=[]、complete=true | 当前权限内这组关键词未命中，不等于全账号无记录 |
# 分类与总概览

`GET /v1/overview` 默认精简交接；`?detail=full&section=projects` 读取项目目标、状态、当前进度和下一步。section 可为 all/personal/projects/mainline/next_actions。状态和覆盖范围是实际已整理的资料，不代表官方账号全部历史；stale_or_scope_restricted 不返回正文。所有项带 evidence_ids，原文用 records/{id}。MCP 对应 get_overview。

`GET /v1/records?category=personal` 与 search_memory 的 category 参数可按 personal/development/other/unclassified 筛选，受相同权限限制。未分类内容仍需按需检索。

`POST /v1/classifications` / MCP classify_memory：`{authorized:true,id,version,expected_revision,categories:["personal","development"]}`；other 不和其他分类共用。先读取 classification.revision，未分类为0。409 不盲目覆盖；更改的是主题元数据，原文版本不变。脚本 classify 从标准输入接收同一对象并回读校验。

总概览的后台启用/暂停/分批处理为网页管理员功能，不给普通 AI Key 管理权限。AI 按授权写入原始事实/项目/计划，后台使用配置好的外部模型更新概要。

## 本人发布的云端战略（Agent 只读）

先读 get_handoff.strategy，再读 overview。get_strategy / GET /v1/strategy?detail=brief|full 返回本人已发布版本、当前周期目标、层级和达成标准。草稿、历史以及所有发布/写入接口不向 Agent 开放，L3 不改变这个限制。strategy.* 逻辑键保留，不能通过普通记忆写入冒充正式目标。新目标必须由本人在密码和 2FA 登录的网页确认发布；建议和观察留在普通记录。
