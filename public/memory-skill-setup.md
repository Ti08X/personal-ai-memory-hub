# 安装个人 AI 记忆 Skill

这是配合 Personal AI Memory Hub 使用的规则和调用脚本。Skill 负责选择资料和处理结果，MCP/REST 提供实际云端通道；安装 Skill 不会自动连接账号。

下载 [Skill ZIP](https://pw.zgatri.com/personal-ai-memory-hub-skill.zip) 和 [SHA-256 校验文件](https://pw.zgatri.com/personal-ai-memory-hub-skill.sha256)。安装包不含 API Key、私人聊天或服务器配置，只有 SKILL.md、界面元数据、调用脚本及两份参考。

## 安装到 OpenClaw

解压整个 personal-ai-memory-hub 文件夹到目标智能体的 `<workspace>/skills/`，或自己的 `~/.openclaw/skills/`。已有同名版本时先备份到 Skill 扫描目录外，再替换；不要清空其他 Skill。具体路径以当前 OpenClaw 的工作区和状态目录配置为准。

打开新会话，确认能找到 personal-ai-memory-hub。可明确调用：

> 使用 $personal-ai-memory-hub，先检查记忆中心连接，再搜索我的过往相关资料。认证失败就报告错误；不要解释成没有记录。

## 选择一种实际连接

| 方式 | 配置 | 适用情况 |
| --- | --- | --- |
| 原生 MCP（优先） | 网站“客户端授权”复制 OpenClaw 配置，用户合并到现有 mcp.servers；URL https://pw.zgatri.com/mcp，Streamable HTTP | 当前运行适配器能发现并实际调用 Hub 工具 |
| Skill + REST | 在 Skill 私有设置填 API Key，注入 PMH_API_KEY；默认 Base URL https://pw.zgatri.com/v1 | 暂无原生 MCP 工具，但能执行 Python 3 |

REST 的 OpenClaw 配置模板（占位值由用户在私有配置中填写）：

```json
{"skills":{"entries":{"personal-ai-memory-hub":{"enabled":true,"apiKey":"YOUR_API_KEY","env":{"PMH_BASE_URL":"https://pw.zgatri.com/v1"}}}}}
```

创建 Key 的弹窗提供“复制 Skill 配置”，其中包含新 Key，只粘贴到自己的私有设置，不发送到对话。已有 Key 无法从网站回显，按原私有配置使用，不要为此让 AI 搜索聊天中的凭证。

MCP 方式由连接配置带认证，不额外要求给 Skill 注入 Key。REST 方式由脚本从环境读取 Key，不需要授权文件。OpenClaw 的 Skill 环境注入默认只作用于主机运行，沙箱需要按用户自己的隔离策略另行配置；不能把主机连接成功当作沙箱也成功。

## 验证使用

1. 加载 Skill 后确认工具存在，或执行包内 `scripts/hub_client.py check`，成功才报告接通。
2. 搜索实际主题，比如“项目规划”，检查成功、数量、引用和分页范围；出现语义降级时仍可关键词搜索。
3. 需要验收保存时，用用户授权的合成资料保存、回读、同 ID 去重。不能把测试记录当用户事实。

| 状态 | AI 应如何报告 |
| --- | --- |
| 认证/权限失败 | 连接或权限问题，不能说没有记录 |
| 关键词成功但为空 | 当前权限下这组词未命中，不能断言从未讨论 |
| 分页未完成 | 明确还有未查范围 |
| 模型供应商限流或不可用 | 说明实际降级关键词，不假装语义生效；Hub 不设模型每日额度 |
| 保存冲突或回读失败 | 报告候选/未校验，先核查已保存内容，不盲目重试 |

更多协议见安装包 references/api.md；实际通道和权限由当前配置决定。这个 Skill 不采集未授权的账号历史、不管理客户端 Key、不绕过 L0–L3，也不保证模型在每次对话自动触发。

官方参考：[OpenClaw Skill 加载](https://docs.openclaw.ai/tools/skills)、[配置与环境注入](https://docs.openclaw.ai/tools/skills-config)。
