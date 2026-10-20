# 每牌组独立学习设置

牌组库每行最右侧的齿轮打开对应牌组设置。统一设置入口管理所有牌组共用的时区；牌组弹窗保留限额、复习展示、日切点及 FSRS 参数。设置弹窗无关闭按钮，支持 Esc、点击面板外空白处和原生焦点管理，面板内点击不关闭。

## 数据与迁移

新增 `deck_settings` 和 `deck_fsrs_params`，以 `deck_id` 为主键，并随牌组删除级联清理。旧的 `app_settings`、`fsrs_params` 保留，供迁移和初始默认值使用；应用不再读写全局训练参数。

首次迁移将原限额复制给现有牌组。英语继承原训练参数、来源、更新时间和日志迁移标志；日语使用 FSRS-6 官方默认参数。新建牌组使用独立默认参数。迁移可重复执行，不覆盖已存在的牌组设置。容器启动自动执行迁移。

保存限额和日切点只改变本牌组后续队列、计数和调度；修改统一时区影响所有牌组。两者都不重排已有卡片。默认保持 Asia/Shanghai、04:00，限额允许 0，时区使用 IANA 名称。日切点使用实际本地日期，覆盖夏令时 23/25 小时日和重复时刻。

全局时区保存在 `app_settings.timezone`，版本为 `app_settings.version`。迁移优先继承现有牌组共同使用的时区，否则使用环境默认值。牌组表原时区列保留用于调度兼容，统一保存时同步该列并增加所有牌组的设置版本，阻止旧时区下启动的训练结果写回。新建牌组继承统一时区，牌组接口不能设置不同的时区；旧客户端传入相同值时兼容忽略。

## 接口

- `GET/POST /api/settings`：统一时区。GET 返回 `{timezone,version}`，POST 只接受 `{timezone}`，不能修改全局限额或训练参数。
- `GET/POST /api/decks/:deckId/settings`：新卡/复习限额、日切点和复习展示；响应 `timezone` 只读并取统一配置。
- `GET/POST /api/decks/:deckId/fsrs/params`：本牌组参数、来源、复习日志数。
- `GET/POST /api/decks/:deckId/fsrs/optimize`：本牌组训练状态/启动。
- `GET/POST /api/decks/:deckId/fsrs/rebuild`：本牌组重建状态/启动；先 POST `{"dryRun":true}` 预览，再 POST `{}` 应用。

无牌组的 `/api/fsrs/*` 以及向 `/api/settings` 提交限额的操作仍返回 400。前端与后端需一同更新。

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
python server/scripts/tests/global-settings-api.py http://127.0.0.1:19002 /dev/shm/flashnext-deck-settings/stage.db
DECK_SETTINGS_TEST_DB=/dev/shm/flashnext-deck-settings/stage.db node server/scripts/tests/deck-settings-repository.cjs
```

实测通过：旧 15 张表逐表内容摘要不变；英语参数和元数据完整保留；重复迁移无修改；限额与日切点计数隔离；CSV、参数和训练任务隔离；旧接口拒绝操作；失效训练写回被拒绝；重建预览不写库、失效预览不覆盖新复习、应用保留记录 ID；删除牌组不复活参数。Chromium 验证桌面/手机齿轮入口、固定牌组标题、保存隔离、训练门槛、Esc/遮罩退出及无浏览器异常。

2026-10-20 统一时区调整：接口验证覆盖时区校验、现有/新建牌组同步、重复保存不增版本、牌组设置隔离与学习记录保留。普通设置读取不启用写事务，避免并发加载复习队列时争用 SQLite。浏览器回归覆盖统一设置保存、桌面/手机点击空白关闭与面板内不关闭，并继续验证公式、音频、倒计时和评分撤销。

此次上线前已备份数据库；迁移后除 `app_settings` 新增统一时区字段外，其余 18 张表内容均未变化，保留 10,594 张卡片、129,044 条复习记录和 343 份音频。11 项浏览器回归通过，线上桌面与手机端也完成只读检查。
