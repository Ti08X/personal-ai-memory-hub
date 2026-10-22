# Personal Workspace · 个人工作台

自托管、单用户工作台：聚合记忆、灵感、项目、工具与基础设施。前端为原生 HTML/CSS/JavaScript，无构建步骤；工作台 API 使用 Node.js 内置 SQLite。记忆接口可接入独立的 Hindsight 服务。

## 2026-10 UI 改版

按八张参考图实现七种页面（项目图重复一张），并提供同风格总览。参考布局包括项目卡片、记忆时间线与详情、灵感卡片、采集任务与流水线、基础设施、工具分类和安全设置。

![项目页（脱敏演示）](docs/screenshots/projects-desktop.png)

[全部页面截图与改版说明](docs/ui-redesign-2026-10.md) · [手机界面](docs/screenshots/projects-mobile.png) · [部署说明](DEPLOY.md)

截图由本目录代码使用合成数据重新渲染；公开代码中的地址、邮箱、设备和记录均为示例。演示状态、计数、日志、成员与设备不代表已接入真实服务。未接入功能会明确提示待确认，不执行容器重启、真实部署、邀请或权限变更。

## 本地预览

在仓库根目录运行：

```sh
npm run preview:workbench
# http://127.0.0.1:8898/#projects
```

预览服务器只提供静态文件，不启动 API，不代理任何线上数据库或记忆服务。

默认 **UI 演示** 展示参考布局；顶部可切换 **实际数据**，通过同源 `/api/wb` 与 `/v1` 读取现有接口。实际模式中未接入的统计不使用演示值填充。

- 导航、⌘K / Ctrl+K 搜索、项目筛选与视图切换、灵感搜索和详情可操作。
- 演示项目/灵感编辑只修改当前页面内存，刷新消失；演示凭据不会持久保存密钥。
- 实际模式的项目、灵感和凭据表单使用原工作台 CRUD；主动保存才会写入 API。
- 凭据列表只读取元数据，不为展示获取明文密钥。密码/Token 输入框保持遮罩。
- 记忆页的编辑/新增/删除暂为待接入交互；参考图不意味着这些接口已实现。

## 配置与部署

API 只监听 `127.0.0.1`，由现有 Nginx/HTTPS 认证反向代理。不要直接公开端口。

```sh
# 先创建受限数据目录；这些文件不得提交 Git。
export WB_DB_PATH=/private/workspace/workbench.sqlite
export WB_KEY_PATH=/private/workspace/.credkey
export PUBLIC_ORIGIN=https://workspace.example.com
node workbench/server.mjs
```

`PORT` 默认为 8890；数据库与密钥默认目录为 `/opt/pw-workbench/data`。`PUBLIC_ORIGIN` 默认 `http://localhost:8898`，正式部署必须设置为自己的 HTTPS 域名。API 保留 AES-256-GCM 凭据加密和独立密钥文件。

Hindsight bank 默认是虚构的 `demo-bank`。在加载 `reference-ui.js` 前设置：

```html
<script>window.WORKSPACE_CONFIG = { memoryBank: 'YOUR_BANK_ID' };</script>
```

此配置只放非敏感标识，不放 API Key、Cookie 或密码。

前端单独发布只需复制 `workbench/portal/index.html` 与 `workbench/portal/assets/`。先备份旧静态目录，上传资源后原子替换 index；无需更改数据库、访问认证或重启 API。仓库其余目录保留较早的 Memory Hub 实现，不是新版工作台前端的入口。

## 验证

```sh
npm run check
npm run test:server
npm run test:workbench:api
# 可选：安装 Playwright 后生成脱敏截图并检查交互。
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:workbench:ui
```

也可用环境变量 `PLAYWRIGHT_MODULE` 指定已安装模块，`CHROME_PATH` 指定本机 Chrome。截图输出至 `workbench/docs/screenshots/`。UI 测试在独立本地静态服务运行，实际数据模式使用合成响应，不访问生产账号。

## 代码目录

- `portal/index.html`：导航、图标与页面外壳。
- `portal/assets/reference-ui.js`：页面、数据切换与交互。
- `portal/assets/reference-ui.css`：新版布局、主题与移动适配。
- `portal/assets/reference-base.css`：基础样式；旧模块保留供回退参考，不被新版加载。
- `portal/assets/reference/`：公开安全的装饰素材和合成 SVG 缩略图。
- `server.mjs`：工作台清单/凭据/API；新增字段声明兼容全新 SQLite 安装。
- `scripts/preview.mjs`、`scripts/verify-ui.cjs`、`scripts/api.test.mjs`：本地预览和隔离检查。

公开仓库不包含私有归档、原始设计压缩包、生产截图、数据库、备份、SSH 私钥或访问凭据。公开版只对演示内容和素材、环境配置入口做了去标识化，不将其反向部署到已有实例覆盖私人配置。
