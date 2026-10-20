# 卡片音频、数学公式与答案显示策略（后端）

本文记录后端接口。Web 已完成接入，见 [Web 使用说明](../web-rich-cards-2026-10-20/README.md)；Flutter App 尚需接入播放器、数学内容展示和倒计时。旧客户端可继续复习现有纯文本卡片。

## 牌组设置

沿用 `GET/POST /api/decks/:deckId/settings`，新增：

| 字段 | 默认值 | 规则 |
| --- | --- | --- |
| `audioAutoplay` | `false` | 严格布尔值；开启后由客户端在展示相应卡面时自动播放音频 |
| `showNewCardAnswerImmediately` | `false` | 严格布尔值；`state=0 && reps=0` 的未学习卡片立即显示答案 |
| `autoRevealAnswerSeconds` | `10` | 1–3600 的整数秒；`null` 关闭定时显示 |

倒计时默认值按用户要求采用 **10 秒**，现有和新建牌组一致。新卡立即显示的优先级高于倒计时；否则按倒计时配置执行。显示答案、播放音频与读取队列都不会自动评分、消耗限额或产生复习日志。

客户端应在卡片实际展示时开始计时，提前翻面、切卡或离开时取消；新卡立即显示时只启动背面自动音频。普通翻面时停止正面音频再播放背面，按 `position` 排序。手动播放不受 `audioAutoplay` 影响。这些是客户端行为约定，Web 已实现；后端不会主动控制播放器或启动定时器。

复习队列 `/api/decks/:deckId/cards/due` 新增 `reviewOptions`（三个配置字段及 `settingsVersion`）。每张卡片返回：

```json
{
  "contentFormat": "plain",
  "media": [],
  "presentation": {
    "audioAutoplay": false,
    "answerRevealAfterMs": 10000,
    "settingsVersion": 0
  }
}
```

`answerRevealAfterMs` 为 `0` 表示立即显示，正数为延迟毫秒数，`null` 为手动显示。该值从卡片当前状态和所属牌组配置计算；评分与撤销响应也会重新计算。

## 卡片内容与音频关联

- `GET /api/cards/:id`：完整卡片。
- `POST /api/decks/:deckId/cards`：创建卡片，兼容原有 `front/back` 请求。
- `PATCH /api/cards/:id`：只编辑内容格式、正文和媒体；不允许提交调度、记忆或牌组归属字段。

创建/编辑请求示例：

```json
{
  "front": "求解 \\(x^2=4\\)",
  "back": "$$x=\\pm 2$$",
  "contentFormat": "markdown_math",
  "media": [
    { "mediaId": "上传返回的文件 UUID", "side": "front", "position": 0 },
    { "mediaId": "另一个文件 UUID", "side": "back", "position": 0 }
  ]
}
```

`front/back` 均为非空文本，每面最多 100,000 个字符。`contentFormat` 为 `plain` 或 `markdown_math`；新建默认 `plain`，编辑时省略则保持原值。音频 `side` 为 `front/back`，`position` 是 0–1000 的整数；每面不能重复位置或重复文件，一张卡片最多 20 个关联。相同文件可以关联不同卡片，也可以同时用于正反面。

PATCH 省略 `media` 表示保留关联，`media:[]` 表示解除全部关联，提供数组表示原子替换关联。无效音频、无效公式或其他校验失败均不应部分修改卡片。卡片详情、分页列表、队列、评分和撤销响应统一返回媒体与展示字段；内部存储路径不对外返回。

## 媒体接口与存储

- `POST /api/media`：`multipart/form-data`，只接受一个 `file` 文件，返回 `id/mimeType/bytes/originalName/createdAt/url`。以 `id` 作为卡片关联的 `mediaId`。
- `GET/HEAD /api/media/:id/content`：音频内容，正确的 MIME、Content-Length、ETag 和 Accept-Ranges。
- `DELETE /api/media/:id`：删除未被引用的文件；仍有卡片引用时返回 409。

支持实际为 MP3、M4A、WAV、OGG（含 Opus）的音频，保留原编码。根据文件内容判断格式，不能只通过修改扩展名或 Content-Type 上传其他文件。默认上限 20 MiB，可通过 `FLASHNEXT_MEDIA_MAX_BYTES` 调整（1024–104857600 字节）。相同 SHA-256 的文件复用一条媒体记录，上传中断和校验失败会清理临时文件。

下载支持单一字节范围：`bytes=0-1023`、`bytes=1024-`、`bytes=-1024`，返回 206/Content-Range；无效或不支持的范围返回 416。支持 If-Range、If-None-Match 和 HEAD。跨域允许 Range/条件请求以及 PATCH 预检。

数据库保存 `media_assets` 和 `card_media` 关联，不保存音频二进制。文件目录默认位于绝对 `DATABASE_URL` 对应数据库旁的 `media/`，当前容器为 `/app/data/media`，落盘到宿主机 `server/data/media/`；可用 `FLASHNEXT_MEDIA_DIR` 显式指定。文件名使用 UUID，不使用用户提交的文件名。

删除牌组/卡片时级联删除关联，不删除可复用的媒体。无引用文件通过删除接口清理。**数据库备份不包含音频文件，恢复时需同时保留数据库与媒体目录**；未来迁移备份需在停止写入期间保存二者。不要把媒体文件提交到 Git。

## 数学预览

`POST /api/content/preview`，请求为 `front/back/contentFormat`，可省略文本用于空白预览；格式默认 `markdown_math`。返回两面的 `html/errors`、`valid` 以及渲染器版本和 CSS 地址。

支持 Markdown、行内 `\(...\)`、独立 `\[...\]` 与 `$$...$$`，代码块和行内代码不解释公式，单个 `$` 保留文本含义。KaTeX 生成 HTML/MathML，源码始终保留，不把渲染结果写回卡片正文。

- 预览中的错误返回 `message/offset/line/column`，位置从 1 行、1 列开始，offset 从 0 开始。
- 保存无效公式返回 422，并保留原内容与音频关联。
- 每个公式最多 4000 字符，每面最多 100 个公式，单面渲染结果最多 2 MiB。
- 禁止原始 HTML、远程图片嵌入、外部资源与 HTML 扩展 TeX 命令；限制宏展开，宏不跨公式/卡片共享。

资源本地提供，无需从 CDN 加载：

- `GET /api/content/assets/katex.min.css`
- `GET /api/content/assets/fonts/KaTeX_*.woff2`（也支持 KaTeX 自带 woff/ttf）

这些资源用于客户端渲染数学内容，Web 已在编辑预览和复习页使用。

## 迁移与验证

Prisma schema 新增 `Card.contentFormat`、牌组三个配置字段，以及两个媒体表。启动时同步 schema，现有卡片默认 `plain`，无音频关联；现有牌组默认 10 秒、自动播放关闭、新卡立即显示关闭。迁移不重写原正文、记录 ID、评分、复习时间、记忆字段、到期时间或 FSRS 权重。

验证命令：

```bash
npm run typecheck --prefix server
npm run prod:build --prefix server
npm run typecheck --prefix web
node --test server/scripts/tests/card-content.cjs server/scripts/tests/deck-clock.cjs server/scripts/tests/japanese.cjs
```

集成测试只可指向临时数据库副本与对应的预览服务：

```bash
# 测试覆盖 4096 字节边界时，预览服务设置 FLASHNEXT_MEDIA_MAX_BYTES=4096。
python server/scripts/tests/rich-cards-api.py http://127.0.0.1:19004 /dev/shm/flashnext-rich-cards/stage.db 4096
python server/scripts/tests/deck-settings-api.py http://127.0.0.1:19004 /dev/shm/flashnext-rich-cards/stage.db
DECK_SETTINGS_TEST_DB=/dev/shm/flashnext-rich-cards/stage.db node server/scripts/tests/deck-settings-repository.cjs
```

已在实际容器中验证全部接口、音频四种格式、正常/越界/中断上传、并发去重、分段与缓存请求、共享音频删除保护、公式错误保留原数据、牌组设置隔离、撤销后的展示规则及原有调度隔离测试。Chromium 额外验证后端 HTML 配合本地 CSS/字体能显示分数、根式和矩阵。迁移检查逐表对比原有列，见同目录 migration-check.json。
