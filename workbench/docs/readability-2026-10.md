# Actual-data UI readability — 2026-10-23

**English** | 简体中文说明见下方。

The actual-data interface now has a separate reading layer. It keeps the workspace's blue visual style and navigation while making operational text and collected articles easier to read. Archived reference-demo styling remains available. Actual mode deliberately uses natural panel heights and a responsive content layout, so the former fixed-pixel geometry assertions are no longer its acceptance criterion.

- Body/reading text: 14–16 px; tables: 13 px; metadata and badges: at least 12 px for the checked components. Buttons are larger, with visible keyboard focus.
- Stronger text contrast in light and dark themes. Sampled collection-page text (titles, summaries, sources, metadata, badges and navigation) measured at least **4.94:1 in light** and **7.37:1 in dark**, after theme transitions settled. This is a sampled check, not a complete accessibility audit.
- Collection: source cards on the left, original-news cards in the main column, pipeline/logs beside them on wide screens. Long titles wrap; excerpts, source, publication time and collection time have separate visual roles. Four recent source/news cards are shown before the full-list actions.
- Phone: news appears before source administration. Narrow tables scroll within their panel/dialog; text is not shrunk to fit the screen.
- Memory: the detail pane remains readable on phones; selecting a memory scrolls to its detail. Type labels use Chinese, and the raw stored text is labeled “记忆内容”.
- Fixed panel heights were relaxed, and the refresh/API-status block now participates in page layout rather than overlapping top-bar controls. Overview service gauges have space for their values.

## Preview

All images below use synthetic API fixtures, never production screenshots or private records.

![Collection](screenshots/intel-live-desktop.png)

[Phone collection](screenshots/intel-live-mobile.png) · [Dark collection](screenshots/intel-live-dark.png)

| Page | Actual-mode synthetic preview |
|---|---|
| Overview | [Preview](screenshots/readability/overview-desktop.png) |
| Projects | [Preview](screenshots/readability/projects-desktop.png) |
| Memory | [Preview](screenshots/readability/memory-desktop.png) |
| Ideas | [Preview](screenshots/readability/ideas-desktop.png) |
| Collection | [Preview](screenshots/readability/intel-desktop.png) |
| Infrastructure | [Preview](screenshots/readability/infra-desktop.png) |
| Tools | [Preview](screenshots/readability/tools-desktop.png) |
| Settings | [Preview](screenshots/readability/settings-desktop.png) |

## Validation and deployment

- Actual-mode Chrome checks: 8 pages × 1654, 1366 and 390 px = **24 viewport checks**, no horizontal page overflow or script errors. The checked text components are at least 12 px. Full source-list editing, Enter-to-save, raw article browsing, automatic refresh, failed-source clearing, memory search and overview tabs passed.
- Mobile memory-detail visibility and sampled light/dark text contrast passed. Contrast checking waits for the existing CSS color transitions to finish.
- Archived demo checks: 16 desktop/mobile views and 12 interactions passed. Its old mixed-mode assertion was updated to check a collector-specific fixture count instead of treating memory document counts as collection counts.
- TypeScript and JavaScript syntax checks passed; API/bridge tests: 9 passed; existing server tests: 97 passed / 2 environment skips.
- This release only changes frontend assets and the HTML resource references. Existing API services, authentication, databases, source configuration and model/paid-service flags are preserved. Production assets are hash-checked after the private static backup and atomic replacement.
- Production browser automation was not available in this session. Browser checks use local synthetic fixtures; production verification uses server asset hashes, preserved private configuration and read-only API/authentication checks.

## 中文说明

这次针对真实数据页面的可读性调整：去掉原先 8–11 px 的微小操作文字，正文使用 14–16 px，表格 13 px，辅助信息和状态标签至少 12 px；加深文字颜色，放开面板固定高度。采集页突出标题、原文摘要、来源和两种时间，手机优先显示资讯。采集和记忆仍使用现有真实接口；没有开启付费采集、模型处理或新的个人数据分发。

实现位于 `portal/assets/reference-readable.css` 与 `reference-ui.js`。HTML 必须在原参考样式之后加载新样式文件；部署时保留实例自己的 bank、原图与认证配置。
