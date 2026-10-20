# 每牌组独立学习设置

牌组库每行最右侧的齿轮打开对应牌组设置。移除列表删除 × 与全局设置入口；设置弹窗无关闭按钮，支持 Esc、点击遮罩和原生焦点管理。

## 数据与迁移

新增 `deck_settings` 和 `deck_fsrs_params`，以 `deck_id` 为主键，并随牌组删除级联清理。旧的 `app_settings`、`fsrs_params` 保留，供迁移和初始默认值使用；应用不再读写全局训练参数。

首次迁移将原限额复制给现有牌组。英语继承原训练参数、来源、更新时间和日志迁移标志；日语使用 FSRS-6 官方默认参数。新建牌组使用独立默认参数。迁移可重复执行，不覆盖已存在的牌组设置。容器启动自动执行迁移。

保存限额、时区和日切点只改变本牌组后续队列、计数和调度，不重排已有卡片。默认保持 Asia/Shanghai、04:00，限额允许 0，时区使用 IANA 名称。日切点使用实际本地日期，覆盖夏令时 23/25 小时日和重复时刻。

## 接口

- `GET/POST /api/decks/:deckId/settings`：新卡/复习限额、时区、日切点。
- `GET/POST /api/decks/:deckId/fsrs/params`：本牌组参数、来源、复习日志数。
- `GET/POST /api/decks/:deckId/fsrs/optimize`：本牌组训练状态/启动。
- `GET/POST /api/decks/:deckId/fsrs/rebuild`：本牌组重建状态/启动；先 POST `{"dryRun":true}` 预览，再 POST `{}` 应用。

旧的 `/api/settings`、`/api/fsrs/*` 接口拒绝无牌组操作，返回 400。前端与后端需一同更新。

## 训练与重建

训练日志和 CSV 均按牌组过滤，门槛仍为本牌组 1,000 条复习日志，并要求存在可训练样本。训练只更新该牌组参数，不自动修改卡片。参数/设置有版本号，训练过程中发生变更或牌组已删除时，旧训练结果不可写回。

训练和重建任务状态按牌组保存。为控制原生优化器资源，一次只运行一个训练或重建任务；其他牌组设置仍可查看和保存。任务、重建预览保存在进程内，重启后需重新启动/预览。

重建预览有效 15 分钟；应用时重新核对设置、参数版本和全部卡片/日志摘要。预览后有复习、撤销、增删卡片或设置变更，必须重新预览。应用使用单个数据库事务，只更新本牌组卡片记忆字段、到期时间和日志中的复习前快照；保留卡片 ID、日志 ID、评分、复习时间及耗时。原有卡片和复习记录不删除。

## 验证

```bash
node --test server/scripts/tests/deck-clock.cjs server/scripts/tests/japanese.cjs
python server/scripts/tests/japanese.py
npm run prod:build --prefix server
npm run build --prefix web
```

集成测试必须针对已迁移的临时数据库副本和对应的预览服务，不能指向生产库：

```bash
python server/scripts/tests/deck-settings-api.py http://127.0.0.1:19002 /dev/shm/flashnext-deck-settings/stage.db
DECK_SETTINGS_TEST_DB=/dev/shm/flashnext-deck-settings/stage.db node server/scripts/tests/deck-settings-repository.cjs
```

实测通过：旧 15 张表逐表内容摘要不变；英语参数和元数据完整保留；重复迁移无修改；限额与日切点计数隔离；CSV、参数和训练任务隔离；旧接口拒绝操作；失效训练写回被拒绝；重建预览不写库、失效预览不覆盖新复习、应用保留记录 ID；删除牌组不复活参数。Chromium 验证桌面/手机齿轮入口、固定牌组标题、保存隔离、训练门槛、Esc/遮罩退出及无浏览器异常。
