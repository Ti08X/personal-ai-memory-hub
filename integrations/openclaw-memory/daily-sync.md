# OpenClaw 聊天归档：首次全量回填与每日同步

本教程把 **OpenClaw 当前可读取的既有聊天先回填一次**，核验成功后，再设置每日定时增量归档。它不按每一轮新消息立即上传，也不生成概要。

> 重要：仓库中的 `personal-ai-memory-hub` 插件通过 Hook 捕获插件安装后观察到的本轮消息；它不会扫描旧会话或全客户端历史。只需要每日归档时，将插件配置中的 `autoArchive` 和 `autoSummary` 保持为 `false`。`autoRecall` 是回答前读取 Hub 的独立功能，可按需保留。详见[插件说明](README.md)。

## 工作方式

| 阶段 | 执行内容 | 通过标准 |
| --- | --- | --- |
| 首次运行 | 枚举当前 OpenClaw 实例内已有的用户聊天，读取完整历史，分批导入 Hub | 会话范围已清点；每条消息已回读核验；未覆盖项明确列出 |
| 每天 00:10 | 归档前一个 Asia/Shanghai 自然日新增的聊天，并补传以前失败的条目 | 来源 ID 去重；导入后回读；记录覆盖日期和缺口 |

首次回填可能覆盖较长历史。应先完成回填并检查报告，再开启重复运行的每日任务；如果首次回填尚未完成，每天任务必须继续处理未完成部分，不能将同步游标提前。

## 开始前检查

1. 确认 OpenClaw Gateway 的 Automations/Cron 可用，且任务能够调用 `sessions_list`、`sessions_history` 和 Personal AI Memory Hub 的 `import_conversation`，或使用已配置的 REST 客户端。
2. 检查会话工具的可见范围。列表默认可能只返回活跃会话；需要分别检查已归档会话，并确认范围覆盖这台 OpenClaw 实例中所有相关智能体和用户聊天。群聊只有在你有权将其中内容存入个人 Hub 时才归档。
3. 定时任务的工具权限在创建时受 OpenClaw 当前授权和工具策略约束。隔离会话不会自动获得原对话历史或所有 MCP 工具；必须核对任务运行时实际可用的工具，不能只看到“任务已创建”就认为同步已接通。
4. Hub 客户端 Key 保存在 OpenClaw 服务器的私密配置中。Key 至少需要聊天集合与 `conversation:import` 写入权限；敏感聊天还需要相应的敏感写入授权。不要把 Key 放进此教程、定时任务提示词、公开仓库或运行日志。
5. 每次导入使用来源平台 `openclaw`、原会话 ID、原消息时间和稳定消息 ID。相同消息重试必须重用原 ID，以便 Hub 去重。

## 首次全量回填

1. **清点会话。** 使用 `sessions_list` 检查活跃会话；另外检查 `archived: true` 的归档会话。检查可见的会话类型和智能体，不要只限定当前主会话。排除 cron、hook、heartbeat 和其他系统自动化会话，避免把同步任务自己写回聊天归档。
2. **逐个读取历史。** 对每个真实用户会话调用 `sessions_history`。从 `offset: 0` 开始，按返回的 `nextOffset` 继续读取更早页面，直到没有更多页面；将页面按原时间顺序整理。不要只读最后一段预览。
3. **检查边界标记。** 如果结果出现 `truncated`、`droppedMessages`、`contentTruncated`、`contentRedacted`、超大消息占位或缺少后续页，该会话就不能算完整。先使用可用的正式导出方式补齐；仍无法补齐时，按 `partial` 导入并报告确切缺口。不要扫描未授权的数据库或 transcript 文件来绕过工具权限。
4. **清理消息。** 仅归档实际聊天内容和用户可见的助手回答。排除系统指令、内部推理、凭证、工具调用和工具原始负载；检查会话历史中残留的推理标签或控制标记。保留角色、原始时间、平台、会话 ID 和消息 ID。附件二进制不由本流程上传。
5. **分批导入。** 可调用 Hub MCP 的 `import_conversation`，或 `POST /v1/conversations/import`。该接口每个请求接收 1–10 条消息且请求体最多 256 KiB；这是协议批次大小，不是每日额度。长消息按客户端兼容规则拆分并保留可追溯的原消息关系。`completeness` 只有在会话历史实际完整时才能标为 `full`，否则使用 `partial`。
6. **核验后记进度。** 检查每条返回结果中的 ID、版本、重复标记和冲突，再按 Hub 返回的记录 ID 回读内容、角色、来源与时间。遇到冲突不要覆盖。仅在所有会话及消息都完成回读后，才将首次回填标为完成并记录同步时间；如果自动化被中断，使用同样的稳定 ID 重试。

`sessions_history` 是受可见范围和输出大小约束的结构化历史，不保证等同于未处理的原始 transcript。OpenClaw 官方文档说明了分页方式及截断/丢弃标记；当这些标记出现时，必须如实记录，不能宣称账户全量。

## 每日定时增量

首次回填完成并核验后，创建一个每天运行的 OpenClaw Gateway 自动化任务：

- 时间：**Asia/Shanghai 每天 00:10**；Cron 表达式为 `10 0 * * *`。
- 日期范围：前一个上海自然日 `00:00:00`（含）至当天 `00:00:00`（不含）。
- 每次读取该时间窗内新增的用户聊天，并同时补传之前失败或未核验的记录；不要每天重新导入全部旧历史。
- 如果首次回填未完成，先继续完成回填，不得只处理昨天或提前移动成功游标。
- 任务成功后记录日期、会话数、消息数及回读核验数。发现不可见会话、分页不全、截断、授权错误、冲突或回读不一致时，报告缺口和失败原因。
- 只归档原文，不调用概要生成，不重复搜索，也不把定时任务自己的运行消息作为用户聊天上传。

### 命令行创建示例

以下示例假设教程仓库已在 OpenClaw 服务器上，且命令从仓库根目录运行；它使用 `main` 智能体创建隔离任务。请先按当前 OpenClaw 版本检查 CLI 参数和已授权工具。若仓库不在服务器上，就把完整同步规则写入定时任务提示词，不要依赖服务器上不存在的相对文件。若任务没有历史读取或 Hub 导入权限，应在已认证的管理界面重新授权所需的最小工具集，而不是放宽全局权限。

```bash
openclaw automations create "10 0 * * *" \
  "按本仓库 integrations/openclaw-memory/daily-sync.md 执行每日 OpenClaw 聊天归档；只处理前一个 Asia/Shanghai 自然日、补传失败记录、按原 ID 去重并回读核验；不生成概要。首次全量回填必须先由主人在当前会话启动并核验完成，再启用此日常任务。遇到访问范围或截断问题就报告缺口，不要声称全量成功。" \
  --name "Personal AI Memory Hub daily OpenClaw archive" \
  --session isolated \
  --agent main \
  --tz Asia/Shanghai \
  --exact \
  --no-deliver
```

`isolated` 为任务创建独立运行会话，**不会读取创建对话的历史**；任务必须通过获准的 `sessions_list`/`sessions_history` 工具自行访问目标会话。Automations 创建或变更需要当前 OpenClaw 的相应管理权限。若要把成功/失败报告发送到聊天渠道，应在私密管理界面设置正确的投递目标；不要把渠道凭证写入公开任务文本。

> 不要先开启上面的每日任务、然后假设它会自动完成首次全量回填。建议在已认证的 OpenClaw 会话中先要求 AI 执行“首次全量回填”并查看覆盖报告；确认成功后再创建或启用每日任务。

## 发给 OpenClaw 的设置指令

把下面这段发给已连接 Hub、并能读取本 GitHub 仓库教程的 OpenClaw 管理会话。OpenClaw 应先检查自己实际拥有的工具，再执行；不应把无法访问的数据说成已上传。如果它不能读取仓库文件，请把本教程内容也提供给它。

```text
请按仓库 integrations/openclaw-memory/daily-sync.md 设置 OpenClaw 聊天归档，使用已配置的 Personal AI Memory Hub URL 和 API Key，不要让我在聊天里发送密钥。

先检查 sessions_list、sessions_history、Hub import_conversation/REST 导入工具在当前会话和计划定时任务中是否可用，以及活跃/归档会话、不同会话类型和智能体的实际可见范围。确认没有逐轮上传：如已安装本仓库插件，将 autoArchive 和 autoSummary 保持为 false；不要改动其他插件、Key 或账号设置。

第一阶段：清点并分页读取这台 OpenClaw 实例中全部可见、获准归档的已有用户聊天（包括归档会话；群聊须有权归档）。按教程过滤非聊天内容，使用稳定的 OpenClaw 会话/消息 ID 通过 Hub 导入，逐条回读核验。历史不可见、被截断、分页不全、冲突或失败时如实报告。未核验完成前不要说“全量完成”，也不要推进同步游标。

第二阶段：首次回填完成并核验后，创建每天 Asia/Shanghai 00:10 运行的 Gateway 自动化，处理前一个自然日的聊天，并补传之前失败或未核验的记录。不得逐轮上传，不重复导入旧记录，不生成概要，不上传系统指令、内部推理、密钥或工具原始负载。确认定时任务实际能调用会话读取和 Hub 导入工具后再启用；然后向我报告自动化名称、时间、工具权限和首次回填覆盖范围。
```

## 参考

- [OpenClaw Automations/Cron CLI](https://docs.openclaw.ai/cli/cron)
- [OpenClaw 会话工具](https://docs.openclaw.ai/session-tool)
- [OpenClaw 自动化任务与工具权限](https://docs.openclaw.ai/automation/cron-jobs/payloads)
- [Hub 对话导入接口](../../docs/api.md#原始对话增量导入)
- [OpenClaw 插件说明](README.md)
