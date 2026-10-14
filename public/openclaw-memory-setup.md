# OpenClaw 自动记忆插件 0.1.0

如需首次回填当前客户端全部可读取的聊天、再每天定时归档昨天记录，请先看[OpenClaw 每日同步教程](https://github.com/Ti08X/personal-ai-memory-hub/blob/main/integrations/openclaw-memory/daily-sync.md)。本插件本身采用逐轮 Hook，不负责历史扫描或日程调度；每日同步时请关闭 `autoArchive` 与 `autoSummary`。

接入自己的 Personal AI Memory Hub，让支持这些 hook 的 OpenClaw Gateway 在回答前读交接概要并检索当前问题，在回答后归档已授权的当前用户消息与最终可见回答，逐条回读，随后根据证据更新交接概要。模型调用与数据库仍在现有 Hub；本插件不本地运行嵌入模型，不迁移服务器。

## 安装

需要 Node.js 22+、OpenClaw 2026.10.3 或更新且能实际触发本插件使用的 hooks。官方 SDK 2026.10.3 的入口/config schema 与本地隔离流程已测试；不同宿主运行方式仍需真实验收。Hub 需要部署包含 `/v1/integrations/activity` 的新版。只有下载包或填 MCP URL 不等于插件已加载。

在 OpenClaw 所在服务器安装本包：

```sh
openclaw plugins install ./openclaw-personal-memory-hub.tgz
openclaw plugins list
```

网站“客户端授权”创建独立读写 Key，选定聊天、记忆/摘要等所需集合；用户本项目授权方案为 L3 读写、五集合和五操作，不含 admin。将下面片段合并到当前配置，保留已有 plugins.allow、其他插件和原本 memory slot。若使用 plugins.allow，把 personal-ai-memory-hub 加入现有数组。真实 Key 仅在服务器私有配置或宿主 PMH_API_KEY 环境中输入，不发到聊天；无授权文件。

```json
{
 "plugins":{"entries":{"personal-ai-memory-hub":{
  "enabled":true,
  "hooks":{"allowConversationAccess":true,"allowPromptInjection":true},
  "config":{
   "baseUrl":"https://pw.zgatri.com/v1","apiKey":"YOUR_API_KEY",
   "agentIds":["main"],"autoRecall":true,
   "autoArchive":false,"archiveAuthorized":false,
   "autoSummary":false,"summaryAuthorized":false,"sensitivity":"sensitive"
  }
 }}}
}
```

网站提供“复制自动记忆插件配置”。自动归档/概要默认不启用；只有在你明确选择逐轮归档或自动概要时，才启用对应功能并设置匹配的 `Authorized` 字段。每日批量归档请按每日同步教程另行配置。配置后使用当前版本支持的插件重载方式：

```sh
openclaw plugins reload personal-ai-memory-hub
```

不需要替换内置 memory-core。插件注册 pmh_search/pmh_get 供核对详情；自动读取使用当前工具权限，pmh_search 被禁用时不绕过工具策略。

## 私人会话与运行范围

- 默认只处理 main 智能体、宿主标记 owner-private 的私人会话与明确 inputProvenance=external_user 的用户输入。群聊、其他智能体、系统/heartbeat 触发不自动注入私人画像。
- 老宿主没有 memoryAudience 时，可由用户将实际私人 session key 加入 privateSessionKeys；不要把群聊加入。缺少宿主来源标记、会话/本轮原生消息身份时不猜测边界，不扫描会话文件。
- capture 只取本轮的用户消息和最终可见回答；系统指令、工具结果、thinking/analysis、二进制和未提供文本不上传。原始会话标 partial，不能声称账户历史全量。
- 自动流程只归档插件安装后在已授权私人会话中实际观察到的新消息；不扫描既有会话或全账号历史。
- 完整会话在部分宿主可能还有其他可见中间回答或多媒体，本版不采集它们；因此不能把两条归档叫完整会话采集。
- session_end 负责补传已经进入队列的资料；不额外读取它提供的 transcript path。before_compaction 有可用消息与已建立的本轮身份时补存当前可见文本，否则仅补传。

## 数据流与可靠性

| 环节 | 实际行为 |
| --- | --- |
| 回答前 | get_handoff + 当前问题 hybrid/rerank；同一 admission 重建 prompt 复用本轮结果 |
| 回答后 | 清洗、分段、保存本地加密队列；分批导入并逐条核对文本/角色/来源 |
| 重要上下文 | 新原文回读后自动整理交接概要，带最多 30 条实际证据；不声称全库概要，也不凭空改写独立个人画像或任务记录 |
| 更新概要 | 查现有稳定 key 和版本，合并当前可访问的近期证据，带 expected_version；旧版保留、409 不覆盖 |
| 断线/重启 | 加密队列保留，Gateway 服务启动后每 30 秒检查待办；失败退避至多 5 分钟，恢复后原 ID 重试去重 |
| 凭证失效/权限拒绝 | 队列保留为 blocked；恢复设置后主人可 /pmh_retry，冲突不会被该命令重试 |
| 状态 | /pmh_status 和网站“自动记忆”，只报告实际状态和数量，不输出 Key 或私人正文 |

没有每日模型调用次数额度。协议分批、上下文片段、失败退避是完成可靠读写的机制，不是每日用量预算。网络断开时云端不可能知道本地最新待办数，网站不能把没有事件当没有使用。

队列位于宿主服务 stateDir 下 personal-ai-memory-hub；目录 700，文件/随机加密 key 600，AES-256-GCM。保留该目录和 key 才能恢复离线待办。运行中只使用一个 Gateway 写这份状态；不把该目录放入插件扫描目录或公开备份。队列绑定目的地/owner；未知 owner 的离线任务绑定原凭证，不能静默换站或换账号上传。owner 已核实后同账号 Key 轮换可以继续；未知 owner 的原 Key 失效需先人工核实旧队列，插件不会绕过。

## 验收

1. 确认插件已加载，/pmh_status 返回状态；在私人会话问一个云端已存主题，不提 Skill，检查自动读取事件与回答引用。
2. 提供获授权的合成记忆，例如“自动归档验收：下一步检查记忆插件”，正常对话后检查云端新原文和 verified 计数。
3. 重复同一宿主事件不会重复导入；模拟断线后恢复，检查待办减少、原文不重复。
4. 自动概要需 Hub 的概要模型已配置；未配置时归档可以完成而概要待处理，不能将它们混称完成。
5. 群聊不注入主人资料。缺少 hooks 的宿主/runner只使用 Skill/MCP兼容方案，不能宣称自动链路通过。

测试未代表用户服务器安装或实际模型行为验收，也未修改现有服务器配置。

官方参考：[插件安装](https://docs.openclaw.ai/cli/plugins)、[插件权限与 hook](https://docs.openclaw.ai/plugins/hooks)、[prompt/session 接口](https://docs.openclaw.ai/plugins/hooks/prompt-and-session)。
