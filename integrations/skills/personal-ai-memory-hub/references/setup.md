# 安装与连接

安装整个 personal-ai-memory-hub 文件夹，保留脚本和 references。OpenClaw 可放 `<workspace>/skills/personal-ai-memory-hub/`；共享根目录通常为 `~/.openclaw/skills`，以实际配置为准。新会话确认加载，可明确引用 `$personal-ai-memory-hub`。安装规则与接通云端分别验收。

## 原生 MCP（优先）

网站创建独立 Key，用户在私有设置将复制的配置合并到现有 mcp.servers，不替换其他配置。URL 为 https://pw.zgatri.com/mcp，传输必须 streamable-http，不启用 OAuth。模板占位值由用户填写，Skill 不读取连接中的秘密：

```json
{"mcp":{"servers":{"personal_memory_hub":{"url":"https://pw.zgatri.com/mcp","transport":"streamable-http","headers":{"Authorization":"Bearer YOUR_API_KEY"},"connectionTimeoutMs":10000,"requestTimeoutMs":30000}}}}
```

确认运行适配器实际发现 get_profile、search_memory，再调用读取工具。配置、工具发现、AI 调用分别验证。CLI probe 按官方要求需先停止占用状态目录的 Gateway，不自动停服务，运行中优先 Control UI。

## Skill + REST 兼容

无原生 MCP 工具但有 Python 3 时，由用户把 Key 填入 Skill 的私有 apiKey，按 primaryEnv 注入 PMH_API_KEY，无需授权文件。Base URL 是记忆 Hub，不是模型服务：

```json
{"skills":{"entries":{"personal-ai-memory-hub":{"enabled":true,"apiKey":"YOUR_API_KEY","env":{"PMH_BASE_URL":"https://pw.zgatri.com/v1"}}}}}
```

执行 `python3 "{baseDir}/scripts/hub_client.py" check`。真实 Key 不进 Skill 文件、提示词、命令历史或安装包。缺少注入/占位值时返回 ok:false，不发送占位认证。

OpenClaw apiKey/env 默认只作用于主机智能体执行，沙箱不会自动继承。按用户隔离策略注入或使用已配置的 MCP，不自行关闭沙箱、不打印环境。其他 AI 可由宿主注入同样环境变量；{baseDir} 换为 Skill 目录。

## 权限和验收

聊天通常 L2：读取需 memory:read、sensitive:read、read_level>=2、chats 集合；导入需 conversation:import 与对应写权限。用户选定 OpenClaw L3 读写、五集合和五项普通/敏感操作，无 admin；Skill 不自动提高权限。

验收为加载 Skill → 检查通道 → 实际主题搜索和引用核对。需要写入验证时使用获授权合成记录，保存、回读、同 ID 去重；检查/搜索不写测试资料、不调用概要模型。

官方参考：[Skills](https://docs.openclaw.ai/tools/skills)、[配置和环境注入](https://docs.openclaw.ai/tools/skills-config)、[MCP 传输](https://docs.openclaw.ai/cli/mcp/transports)。
