# Live backend integration / 实时后端接入

Production starts in actual-data mode. Local `preview:workbench` explicitly enables synthetic demo mode; public screenshots remain synthetic. Set `window.WORKSPACE_CONFIG={memoryBank:"your-bank",refreshMs:30000}` before loading the UI. Omitting `demo:true` keeps actual mode.

生产默认实际数据；本地预览显式启用演示。公开截图仍为合成样例，不包含生产记录。

| Module / 模块 | Source / 来源 | Coverage / 范围 |
| --- | --- | --- |
| Projects, ideas, tools, infrastructure records / 项目、灵感、工具、资产 | SQLite items API | Saved records and real timestamps; saved status is not a remote health probe / 已保存记录，记录状态不等于远端健康检查 |
| Credentials / 凭据 | Credentials API | Masked metadata and configured encryption; values remain encrypted / 脱敏元数据、加密配置 |
| Memory / 记忆 | Hindsight stats, list, tags, graph, timeseries | Real aggregate counts; paginated list, backend search; graph is a bounded sample / 聚合统计、分页列表、后端搜索，图谱为有限样本 |
| Ingestion / 导入 | Hindsight operations and documents | Actual document ingestion tasks, not an external content crawler / 文档导入任务，不代表外部内容采集 |
| Host resources / 服务器资源 | Node OS APIs and Linux procfs | Current host CPU, memory, root disk, default-interface traffic / 当前主机资源与默认网卡流量 |
| Containers / 容器 | Local Docker CLI | All container states and available running-container metrics; no environment values / 容器状态与可用运行指标，不读取环境密钥 |
| TLS certificate / 证书 | Configured public origin certificate | One configured origin certificate, not a DNS/domain inventory / 配置的源站证书，不代表完整域名清单 |
| Security and activity / 安全与审计 | Configuration checks and local mutation log | Cipher/key permissions; workbench mutations since instrumentation, no historic login audit / 加密和权限检查、接入后的工作台操作，不追溯登录历史 |
| External collection, alerts, members/devices / 外部采集、告警、成员设备 | No backend configured | Explicitly pending; no fabricated counters or security score / 明确待接入，不编造数量或安全评分 |

Pages refresh every 30 seconds while visible, refresh upon returning to the tab, and support manual refresh. Each source has its own status and completion time. Failed sources clear their displayed data instead of substituting demo values. The interface is periodically refreshed, not a WebSocket stream. Dialogs defer redraw until closed.

页面可见时每 30 秒刷新，返回页面时刷新，也支持手动刷新。接口分别显示状态与完成时间；失败清空对应数据，不回填演示值。这是定时刷新，不是逐事件推送。

Host sampling runs every 15 seconds. SQLite retains 24 hours of samples; charts return the latest 120 samples, so chart coverage is bounded. The first CPU/network interval is unavailable until enough time has elapsed. The mutation log retains 1,000 records and returns the latest 100; it records method, resource class, status and timestamp, never request bodies or credential values.

主机每 15 秒采样，保存 24 小时，图表显示最近 120 点。首次 CPU/网速等待有效采样间隔。操作日志保留 1,000 条、返回最近 100 条，只记录方法、资源类别、状态和时间，不记录正文或凭据值。

## Deployment configuration

Keep the API bound to loopback behind the existing authenticated reverse proxy. Preserve the existing database, credential key, private bank and authentication configuration. `PUBLIC_ORIGIN` controls CORS and rejects foreign browser origins for mutations. `WB_TLS_CERT_PATH` may point to the public PEM certificate chain; never configure it with a private key. The database changes add only telemetry and sanitized activity tables. No existing business record migration or credential re-encryption is required.

部署保持回环监听、反向代理鉴权、原数据库/密钥与私人 bank。`PUBLIC_ORIGIN` 限制浏览器写入来源；`WB_TLS_CERT_PATH` 只指向公开证书链，不能指向私钥。新增数据表仅用于资源采样与脱敏审计，不修改已有业务记录。

Before deployment, back up code and obtain a consistent SQLite backup with integrity checks. For rollback restore the previous API and static files, then restart the service. Added tables are backward compatible; do not overwrite a live database with an older snapshot after new business writes.

发布前备份代码、取得一致的 SQLite 备份并校验。回滚恢复代码/静态文件并重启即可；新增表向后兼容。产生新业务写入后，不可直接用旧数据库覆盖。

## Verification

- API suite: 7 tests passed, including real telemetry/configuration, same-origin write protection and isolated CRUD.
- Synthetic live UI: 16 desktop/mobile viewport checks, automatic refresh, backend search, real source timestamps, failed-source clearing and live default on reload; no script errors or overflow.
- Reference demo UI: 16 viewports and 12 interaction checks passed.
- Legacy server regression: 97 passed, 2 environment-dependent skips, 0 failures.
- Production acceptance is read-only: compare API/UI values, check every configured source, verify unauthenticated requests remain blocked. Private captures, exact personal records and backups are excluded from this repository.
