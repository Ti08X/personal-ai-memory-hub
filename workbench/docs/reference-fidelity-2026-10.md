# Reference layout correction / 参考图布局复核

The eight supplied reference PNGs contain seven unique page designs: references 01 and 05 are identical. The extra overview has no supplied reference. The target viewport is 1654 × 951; reference 08 is 1655 × 950 and is checked at the common viewport.

用户提供的八图包含七种独立页面，01/05 为同图；总览没有独立参考。以原图 1654 × 951 为桌面基准，08 的尺寸为 1655 × 950，统一基准校验。

The live-data release had simplified several page structures. This correction restores the reference components while preserving the live adapters:

- Projects: three columns, original thumbnail and metadata slots, status filters and action rows.
- Memory: left classification/tag/graph panels, central timeline, raised right detail cover, matching KPI geometry.
- Ideas: four-column cards and the right statistics, tags, quick-note and collection panels.
- Collection: original tabs, source table, task column, pipeline and log positions; missing collection services remain marked pending.
- Infrastructure: six summary tiles and three columns of servers/certificates, containers/security, monitoring/logs.
- Tools: quick-access tiles, eight category cards and the right status/recent/scripts panels.
- Security: original summary, credentials, permissions, security/device sidebar and three lower settings panels.

真实模式恢复原图全部主要分区，刷新信息收进顶栏，不再额外插入横条改变纵向排版。待接入模块保留对应表格、面板、按钮和图标的位置，数值留空或标记待接入，不复制原图中的虚构服务状态、安全评分或个人记录。

## Verification

`npm run test:workbench:live` checks 22 measured component rectangles across all eight reference numbers, including both identical project references. At the target viewport, position and size differences are at most 3 CSS pixels for these measured rectangles. The expected measurements are checked into `scripts/reference-geometry.json`; results are in `docs/live-ui-verification.json`.

几何回归覆盖八图的 22 个主要区域，目标视口下各区域的位置/宽高偏差不超过 3 CSS 像素。此为明确边界的布局检测，不是整页逐像素零差异证明；真实数量、正文、图谱/曲线、记录条数和待接入状态由实际后端决定。字体栅格化还受操作系统、浏览器与缩放比例影响。

Both live and demo flows have 16 desktop/mobile viewport checks without horizontal overflow or script errors. Live refresh, backend search, source failure clearing and actual mode on reload remain covered. The reference demo has 12 additional interaction checks. Type checks and API tests pass; legacy regression remains 97 passed, 2 environment-dependent skips, no failures.

## Artwork and privacy

The public preview uses sanitized artwork and synthetic content. An existing private instance may set the non-secret `referenceArtwork: 'original'` option to use its already-installed original PNG crops instead of sanitized SVG placeholders. This does not copy private artwork into the public repository. Project and idea pictures are decorative reference illustrations, not live screenshots of a service; tool status comes from saved records rather than active remote probes.

公开仓库仍使用脱敏素材和合成截图。既有私有实例可配置 `referenceArtwork: 'original'` 继续使用原图 PNG 裁切素材；不将这些私人素材或生产截图提交 GitHub。项目缩略图/灵感封面是装饰示意，并非实时服务截图；项目/工具状态来自登记记录，服务器监控来自真实采样。

Deployment updates only the frontend JS/CSS and the versioned index after a static backup. No API code, database, authentication, key or personal memory content changes are required.
