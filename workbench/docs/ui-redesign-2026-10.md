# 2026-10 工作台 UI 改版

2026-10-23 后续：[可读性迭代](readability-2026-10.md) 放大实际数据模式的文字，放开固定面板高度，调整手机阅读顺序；历史参考图演示保留。

2026-10-23：真实数据模式现已恢复参考图布局，新增八图 22 个区域的几何回归，详见[参考图布局复核](reference-fidelity-2026-10.md)。下文为初次公开版本记录。

本次将参考图中的七类页面重建为可交互前端，并按后补的 AI 生产力总览参考图重建总览。公开代码与正式 UI 使用同一布局和交互实现；下面的图全部从公开版合成数据重新渲染，不是私人运行数据的截图。

## 页面预览

| 页面 | 桌面 | 手机 |
|---|---|---|
| 我的项目 | [查看](screenshots/projects-desktop.png) | [查看](screenshots/projects-mobile.png) |
| 记忆系统 | [查看](screenshots/memory-desktop.png) | [查看](screenshots/memory-mobile.png) |
| 灵感 | [查看](screenshots/ideas-desktop.png) | [查看](screenshots/ideas-mobile.png) |
| 信息采集 | [查看](screenshots/intel-desktop.png) | [查看](screenshots/intel-mobile.png) |
| 基础设施 | [查看](screenshots/infra-desktop.png) | [查看](screenshots/infra-mobile.png) |
| 效率工具 | [查看](screenshots/tools-desktop.png) | [查看](screenshots/tools-mobile.png) |
| 安全与设置 | [查看](screenshots/settings-desktop.png) | [查看](screenshots/settings-mobile.png) |
| 总览 | [查看](screenshots/overview-desktop.png) | [查看](screenshots/overview-mobile.png) |

![项目页](screenshots/projects-desktop.png)
![记忆页](screenshots/memory-desktop.png)
![灵感页](screenshots/ideas-desktop.png)
![采集页](screenshots/intel-desktop.png)
![基础设施](screenshots/infra-desktop.png)
![效率工具](screenshots/tools-desktop.png)
![安全与设置](screenshots/settings-desktop.png)

## 脱敏范围

- IP 使用文档专用网段，域名和邮箱使用 example.com；不含真实服务器地址或个人邮箱。
- 用户头像改为通用 SVG；设备、位置、笔记、行程、投资/健康计划和私人会话描述改为合成内容。
- 包含可识别文字的后台、手机、代码和笔记缩略图改为合成 SVG；保留不含私人内容的装饰背景和产品图标。
- 不提交原始八图、设计 ZIP、生产凭据、归档、备份、数据库、服务器路径快照或未经脱敏的验收文件。
- 所有截图均为 UI 演示。参考计数与卡片数可能不一致；这些数值不是实际项目数量、服务健康或安全评分的证明。

## 代码与接口

前端主入口在 `workbench/portal/`，保持原生 DOM 实现。实际模式接入同源工作台清单/凭据接口及可配置 Hindsight bank。未接入模块明确说明待确认。

同步当前工作台 API 的灵感分类、mechanism/potential/thumb 元数据与只读容器状态路由；为这些字段增加新库建表声明。增加可选数据库、密钥路径、端口和公开 Origin 环境变量，便于隔离验证；未发布到已有服务器，也未修改已有实例认证或数据。

## 结果与复现

- 桌面 1654×951、手机 390×844：8 页 × 2 个视口，无页面横向溢出，脚本错误 0。
- 12 项交互检查覆盖导航、搜索、筛选、详情、演示草稿、主题、开关及合成实际接口模式。
- 工作台 API 隔离测试覆盖新库字段、灵感 CRUD、凭据列表遮罩和输入校验。
- `screenshots/browser-results.json` 记录浏览器结果；静态文件清单和脱敏检查见 `public-release-verification.json`。

运行和截图重建命令见 [工作台 README](../README.md)。视觉比对用于还原参考布局，不声称已证明逐像素零差异。
