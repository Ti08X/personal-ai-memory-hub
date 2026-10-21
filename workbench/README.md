# Personal Workspace · 个人工作台

一个自托管、单用户的个人工作台。把「长期记忆」「项目清单」「链接凭据」「运维面板」收拢到同一个入口，解决的核心问题是：**换一个 AI、换一台机器、隔几周回来，怎么在五分钟内重新接手全部项目。**

> 工作台本身不存储对话，不生成回答。记忆由 [Hindsight](https://github.com/vectorize-io/hindsight) 承担，工作台负责聚合、编排和交接。

---

## 特点

| | |
|---|---|
| **单一入口** | 记忆检索、项目清单、凭据库、容器状态在同一页面 |
| **上下文交接** | 一键生成 Markdown 项目上下文，粘贴给任意 agent 即可接手 |
| **凭据加密** | 密码与 Token 用 AES-256-GCM 加密入库，密钥独立存放 |
| **零依赖** | 后端单文件 Node，前端原生 HTML/CSS/JS，无构建步骤 |
| **双主题** | 默认亮色；中国时区 01:00–07:00 自动切暗色，也可手动切换 |
| **移动可用** | 单列堆叠布局，手机上也能完整操作 |

---

## 架构

```
                       ┌──────────────────────────────┐
   浏览器 ──HTTPS──▶    │  OpenResty / Nginx           │
                       │  · Basic Auth                │
                       │  · /            → 静态前端    │
                       │  · /api/wb/*    → 8890       │
                       │  · /v1/*        → 8888       │
                       │  · /console     → 9999       │
                       └───────┬───────────┬──────────┘
                               │           │
                    ┌──────────▼──┐   ┌────▼─────────────┐
                    │ Workbench API│   │ Hindsight API    │
                    │ Node 22      │   │ :8888            │
                    │ :8890        │   │                  │
                    └──────┬───────┘   └────┬─────────────┘
                           │                │
                    ┌──────▼──────┐   ┌─────▼────────────┐
                    │ SQLite      │   │ PostgreSQL       │
                    │ workbench   │   │ pgvector :5433   │
                    └─────────────┘   └──────────────────┘
```

前端不经过任何构建工具，所有交互直接调 REST 接口。工作台 API 与记忆 API 完全解耦，可以单独部署。

---

## 功能模块

### 1. 总览

四组实时指标（认知节点 / 关联链接 / 归档文档 / 深度观察）、近 7 天写入趋势柱状图、事实构成环形图、全部资产快照、最近记忆流。数据均来自 Hindsight 实时接口，60 秒刷新一次。

### 2. 记忆系统

为六种客户端生成可直接粘贴的 MCP 配置：Claude Desktop、Cursor、Codex CLI、OpenClaw、Windsurf、原生 HTTP。附带一段可复制的系统提示词，规定 AI 何时召回、何时沉淀。

### 3. 项目清单

增删改查你的站点、服务和工具。每个条目可填写：

- 落地页、管理台地址
- 代码仓库、部署路径、技术栈
- 账号、密码
- 多行说明（换行保留）
- 关联的链接凭据（多选）

卡片上直接显示全部字段：地址可点击跳转，账号密码**点一下即复制**，密码默认遮罩、双击临时明文。回车不会误触保存，只能手动点「保存」。

### 4. 链接凭据

独立于项目存在的凭据库，支持 Cloudflare / GitHub / SSH / API Key / 数据库 / 其他六类。每条可填适用范围、账号、密码、Token、备注。

项目与凭据是多对多关系：同一份 Cloudflare Token 可以挂到多个域名项目上。

### 5. 项目上下文生成

项目卡片上的剪贴板按钮会请求 `/api/wb/items/:id/context`，生成一份完整 Markdown：

```markdown
# 项目接手上下文：某项目

## 一、基本信息     名称 / 分类 / 状态 / 技术栈
## 二、访问入口     落地页 / 管理台 / 仓库 / 部署路径
## 三、项目说明     自定义多行说明
## 四、访问凭据     关联凭据的账号、密码、Token、适用范围
## 五、接手须知     变更提示与安全约定
```

复制后粘贴给任何 agent，对方无需再问「代码在哪、怎么部署、密钥是什么」。

---

## 快速开始

```bash
# 1. 部署后端
sudo mkdir -p /opt/pw-workbench/data && sudo chmod 700 /opt/pw-workbench/data
sudo install -m 600 workbench/server.mjs /opt/pw-workbench/server.mjs
sudo systemctl enable --now pw-workbench

# 2. 部署前端
sudo cp -r workbench/portal/* /www/sites/<host>/portal/

# 3. 配置反向代理（详见 DEPLOY.md）

# 4. 浏览器访问
open https://<host>/
```

完整步骤、systemd 单元、Nginx 配置、备份与排障见 **[DEPLOY.md](DEPLOY.md)**。

---

## 数据与安全

### 加密

密码与 Token 使用 **AES-256-GCM** 加密后入库，AAD 固定为 `pw-workbench:cred`。密钥文件 `.credkey` 首次启动随机生成（32 字节），权限 `600`，与数据库分离存放。

**`.credkey` 丢失 = 所有凭据永久不可解密。** 备份时必须与数据库一起备份。

### 接口暴露面

- 列表接口只返回 `••••••••`，不返回明文
- 只有单条读取与上下文生成会解密
- 工作台 API 只监听 `127.0.0.1:8890`，外部访问必须经过反向代理的 Basic Auth

### 缓存

前端资源全部 `no-store`，配合 URL 上的 `?v=N`。这不是过度设计——曾有 CDN 边缘节点缓存旧文件导致页面样式错乱、排查半小时的经历。

---

## 技术选型说明

**为什么是 `node:sqlite` 而不是 better-sqlite3**：本工作台数据量以千条计，单文件 SQLite 足够；用内置模块可以做到零 `npm install`，部署就是复制一个 `.mjs`。

**为什么前端不用框架**：页面只有六个视图、五个 JS 文件。引入 React 会带来构建链、版本升级和 hydration 问题，而收益接近于零。原生 DOM 操作在这个规模下更直接。

**为什么凭据和项目分表**：同一个 Cloudflare Token 往往服务多个域名。分开建模后，改一次凭据，所有引用它的项目上下文同时更新。

---

## 目录结构

```
workbench/
├── server.mjs                 # API：清单、凭据、关联、上下文生成
├── DEPLOY.md                  # 部署与运维手册
└── portal/
    ├── index.html             # 单页外壳与图标集合
    └── assets/
        ├── workbench.css      # 双主题、全部样式
        ├── workbench.js       # 导航、主题、统计、图表、命令面板
        ├── creds.js           # 凭据 CRUD
        └── items.js           # 项目 CRUD、凭据绑定、上下文复制
```

---

## 与 Personal AI Memory Hub 的关系

本仓库原为 **Personal AI Memory Hub**（Cloudflare Workers + D1 + Qdrant 的自托管记忆服务）。该实现已于 2026-10 退役，记忆后端迁移至 **Hindsight**（pgvector）。

- 旧代码保留在仓库中原位置，作为历史存档，不再维护
- 新工作台代码位于 `workbench/` 目录
- 记忆的读写、召回、认知提炼全部由 Hindsight 承担；工作台只负责展示和编排

---

## 许可

见 [LICENSE](LICENSE)。
