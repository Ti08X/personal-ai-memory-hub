# ZGATRI Workspace · 个人工作台

[English](README.md) | **简体中文**

一个自托管的个人工作台，统一管理记忆、灵感、项目、工具与基础设施。使用原生 HTML、CSS、JavaScript 与 Node.js/SQLite API，可选接入 Hindsight 记忆后端。

[快速开始](#快速开始) · [界面预览](#界面预览) · [工作台说明](workbench/README.zh-CN.md) · [部署说明](workbench/DEPLOY.md)

## 功能

| 模块 | 界面内容 |
| --- | --- |
| 我的项目 | 卡片、列表、状态筛选、项目详情与编辑 |
| 记忆系统 | 分类、标签、时间线、关联内容与详情侧栏 |
| 灵感 | 卡片/列表/看板、搜索、标签与快速记录 |
| 信息采集 | 采集源、任务、处理流水线与日志 |
| 基础设施 | 服务器、容器、域名、资源监控与安全面板 |
| 效率工具 | 快捷入口、分类、最近使用与脚本入口 |
| 安全与设置 | 凭据元数据、成员、设备、偏好与通知 |
| 总览 | 记忆指标与项目卡片的统一入口 |

默认 **UI 演示** 使用合成内容展示参考布局；切换 **实际数据** 后读取已配置的同源接口。部分采集、监控、权限和记忆编辑控件仍为待接入界面，不执行生产操作。演示统计不代表真实服务状态或安全评分。

## 快速开始

需要 Node.js 22.18 或以上版本。在仓库根目录运行：

```sh
git clone https://github.com/Ti08X/zgatri-workspace.git
cd zgatri-workspace
npm run preview:workbench
```

打开 [http://127.0.0.1:8898/#projects](http://127.0.0.1:8898/#projects)。预览只提供静态文件，不连接生产数据库。API 安装、配置与验证见 [工作台说明](workbench/README.zh-CN.md)。

## 界面预览

以下图片均从公开代码使用脱敏合成数据重新渲染。地址、账号、设备与记忆条目为示例，含私人文字的缩略图已替换为合成素材。[浏览全部 16 张桌面/手机截图](workbench/docs/ui-redesign-2026-10.md)。

### 我的项目

![我的项目 · 脱敏演示](workbench/docs/screenshots/projects-desktop.png)

[查看手机界面](workbench/docs/screenshots/projects-mobile.png)

### 记忆系统

![记忆系统 · 脱敏演示](workbench/docs/screenshots/memory-desktop.png)

[查看手机界面](workbench/docs/screenshots/memory-mobile.png)

### 灵感

![灵感 · 脱敏演示](workbench/docs/screenshots/ideas-desktop.png)

[查看手机界面](workbench/docs/screenshots/ideas-mobile.png)

### 信息采集

![信息采集 · 脱敏演示](workbench/docs/screenshots/intel-desktop.png)

[查看手机界面](workbench/docs/screenshots/intel-mobile.png)

### 基础设施

![基础设施 · 脱敏演示](workbench/docs/screenshots/infra-desktop.png)

[查看手机界面](workbench/docs/screenshots/infra-mobile.png)

### 效率工具

![效率工具 · 脱敏演示](workbench/docs/screenshots/tools-desktop.png)

[查看手机界面](workbench/docs/screenshots/tools-mobile.png)

### 安全与设置

![安全与设置 · 脱敏演示](workbench/docs/screenshots/settings-desktop.png)

[查看手机界面](workbench/docs/screenshots/settings-mobile.png)

### 总览

![总览 · 脱敏演示](workbench/docs/screenshots/overview-desktop.png)

[查看手机界面](workbench/docs/screenshots/overview-mobile.png)

## 项目结构

```text
workbench/
  portal/       当前工作台 UI 与素材
  server.mjs    Node.js/SQLite 工作台 API
  scripts/      静态预览与隔离 API/UI 验证
  docs/         改版说明与脱敏截图
```

其他 `src/`、`server/`、`public/` 和集成目录保留早期 Memory Hub 实现。[历史说明](docs/legacy-memory-hub-readme.md) 描述该独立实现，不是新版工作台的入口。

## 文档

- [工作台使用与配置](workbench/README.zh-CN.md)
- [部署与运维](workbench/DEPLOY.md)
- [UI 改版与截图集](workbench/docs/ui-redesign-2026-10.md)
- [公开版本验证记录](workbench/docs/public-release-verification.json)
- [历史 Memory Hub 文档](docs/legacy-memory-hub-readme.md)

访问认证由反向代理保护，API 只监听本机回环地址。源码分发不包含生产数据库、私人归档、凭据或备份。

## 许可证

[ISC](LICENSE)
