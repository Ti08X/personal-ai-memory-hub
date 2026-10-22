# Workspace 部署与运维

本文说明 `workbench/` 目录在 Linux 服务器上的完整部署流程。

---

## 一、前置条件

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 22 | 需支持内置 `node:sqlite` |
| Debian / Ubuntu | 22.04+ | 其他发行版同理，systemd 必需 |
| OpenResty / Nginx | 任意现代版本 | 反向代理 + TLS |
| 域名 + HTTPS | — | 浏览器剪贴板 API 需要安全上下文 |

`node:sqlite` 在 Node 22 中标记为实验特性，启动时会打印 `ExperimentalWarning`，属正常现象。

---

## 二、目录规划

```
/opt/pw-workbench/
├── server.mjs                 # API 服务（单文件，无外部依赖）
└── data/                      # 700
    ├── workbench.sqlite       # 数据库（含清单、凭据、关联表）
    └── .credkey               # AES-256 密钥（600，首次启动自动生成）
```

静态前端放在 OpenResty 的站点目录：

```
/www/sites/<host>/portal/
├── index.html
└── assets/
    ├── workbench.css
    ├── workbench.js           # 导航、主题、统计、图表
    ├── creds.js               # 链接凭据管理
    └── items.js               # 项目清单与上下文复制
```

---

## 三、部署 API

```bash
sudo mkdir -p /opt/pw-workbench/data
sudo chmod 700 /opt/pw-workbench/data

sudo install -m 600 server.mjs /opt/pw-workbench/server.mjs
```

创建 systemd 单元 `/etc/systemd/system/pw-workbench.service`：

```ini
[Unit]
Description=Workbench API
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/node /opt/pw-workbench/server.mjs
Restart=always
RestartSec=3
StandardOutput=append:/var/log/pw-workbench.log
StandardError=append:/var/log/pw-workbench.log

[Install]
WantedBy=multi-user.target
```

启用并验证：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pw-workbench
curl -s http://127.0.0.1:8890/api/health
```

预期输出：`{"ok":true,"items":17,"creds":0}`

---

## 四、部署前端

```bash
sudo mkdir -p /www/sites/<host>/portal/assets
sudo cp portal/index.html            /www/sites/<host>/portal/
sudo cp portal/assets/workbench.css  /www/sites/<host>/portal/assets/
sudo cp portal/assets/workbench.js   /www/sites/<host>/portal/assets/
sudo cp portal/assets/creds.js       /www/sites/<host>/portal/assets/
sudo cp portal/assets/items.js       /www/sites/<host>/portal/assets/
sudo chmod 644 /www/sites/<host>/portal/index.html /www/sites/<host>/portal/assets/*
```

> 静态资源引用带 `?v=N` 版本号。改前端后需要同步递增 `index.html` 里的版本号，否则浏览器和 CDN 会继续使用旧缓存。

---

## 五、反向代理

在站点 vhost 中加入以下 location。**顺序很重要**：更具体的路径必须写在 `location /` 之前。

```nginx
# 工作台 API
location /api/wb/ {
    rewrite ^/api/wb/?(.*)$ /api/$1 break;
    proxy_pass http://127.0.0.1:8890;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 30s;
}

# 前端静态页
location = / {
    root /www/sites/<host>/portal;
    try_files /index.html =404;
    add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always;
}

location /assets/ {
    root /www/sites/<host>/portal;
    add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always;
    add_header CDN-Cache-Control "no-store" always;
    try_files $uri =404;
}
```

修改后检查并重载：

```bash
nginx -t && nginx -s reload
```

### 缓存策略说明

`/` 与 `/assets/` 都设成 `no-store`。原因是工作台作为个人面板，每次访问都应该是当前版本；配合 URL 上的 `?v=N`，可以彻底规避 CDN 边缘节点返回旧文件的问题。

如果前面有 Cloudflare，额外加 `Cloudflare-CDN-Cache-Control: no-store`，这个头的优先级高于普通 `Cache-Control`。

---

## 六、HTTPS 与访问控制

工作台本身不含登录页，建议在代理层加 HTTP Basic Auth：

```bash
printf 'user:%s\n' "$(openssl passwd -apr1 '你的密码')" | sudo tee /www/sites/<host>/auth/.htpasswd
sudo chmod 640 /www/sites/<host>/auth/.htpasswd
```

在 vhost 的 server 块中加入：

```nginx
auth_basic "Private Workspace";
auth_basic_user_file /www/sites/<host>/auth/.htpasswd;
```

**不要**加 `limit_req` 限制总请求数。前端是单页应用，一次打开会并发拉取 HTML、字体、CSS 和 5 个 JS 文件，容易被限流规则误杀成 503。若要防暴力破解，应改为在认证失败上计数，而不是限制全站。

---

## 七、备份

数据库是单文件 SQLite，冷备即可：

```bash
sqlite3 /opt/pw-workbench/data/workbench.sqlite ".backup '/var/backups/wb-$(date +%F).sqlite'"
```

`.credkey` 必须与数据库一起备份，**丢失后所有密码和 Token 都无法解密**：

```bash
sudo tar czf /var/backups/wb-key-$(date +%F).tar.gz -C /opt/pw-workbench/data .credkey
chmod 600 /var/backups/wb-key-*.tar.gz
```

建议加一条 cron：

```cron
30 3 * * * sqlite3 /opt/pw-workbench/data/workbench.sqlite ".backup '/var/backups/wb-$(date +\%F).sqlite'" && find /var/backups -name 'wb-*.sqlite' -mtime +14 -delete
```

---

## 八、故障排查

| 现象 | 排查方向 |
|---|---|
| `EADDRINUSE 8890` | 有残留进程占着端口，`pgrep -f server.mjs` 后 kill，再 `systemctl restart` |
| API 返回 404 | 检查 `location /api/wb/` 的 rewrite 是否生效，`curl -s http://127.0.0.1:8890/api/health` 直连验证 |
| 页面样式错乱 | 强刷（Ctrl+Shift+R），确认 `?v=N` 已递增 |
| 密码无法解密 | `.credkey` 与数据库不匹配，检查是否被替换或丢失 |
| 复制上下文无反应 | 浏览器剪贴板 API 需要 HTTPS；检查控制台是否有 `NotAllowedError` |

查看日志：

```bash
sudo tail -50 /var/log/pw-workbench.log
sudo journalctl -u pw-workbench -n 50 --no-pager
```

---

## 九、升级流程

1. 备份数据库与 `.credkey`
2. 替换 `/opt/pw-workbench/server.mjs`
3. `sudo systemctl restart pw-workbench`
4. `curl -s http://127.0.0.1:8890/api/health` 确认返回 `ok:true`
5. 替换前端文件，并递增 `index.html` 中的 `?v=N`
6. 浏览器强刷验证

数据库表结构变更是自动的：`server.mjs` 启动时会执行 `CREATE TABLE IF NOT EXISTS` 与 `ALTER TABLE ADD COLUMN`（先查 `PRAGMA table_info` 再决定是否添加），不需要手工迁移。

## 2026-10 新版前端补充

新版入口是 `portal/index.html`，加载 `reference-base.css`、`reference-ui.css` 与 `reference-ui.js`。完整预览及接口边界见 [README](README.md)。旧 CSS/JS 留在目录中作历史材料，不被新版页面加载。

仅同步 UI 时，先备份原静态目录，上传 assets 后原子替换 index 即可；不要为前端更新替换数据库、密钥、访问认证或重启无关服务。

新版 API 可通过 `WB_DB_PATH`、`WB_KEY_PATH`、`PORT`、`PUBLIC_ORIGIN` 配置运行环境。正式环境设置自己的 `PUBLIC_ORIGIN`；Hindsight bank 在前端的 `window.WORKSPACE_CONFIG.memoryBank` 配置。示例域名、IP、账号与图像均为脱敏演示，不能直接当作服务器配置。
