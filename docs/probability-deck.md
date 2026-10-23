# 高中概率论牌组

首版包含 24 张原创中文知识卡，统一标记「高中」。六个主题为基础概念、事件关系与概率运算、计数基础、条件概率与全概率、随机变量与数字特征、常见分布。卡片包含定义、公式、适用条件和易混说明，不包含解题卡或自动答题判定。

内容保存在 `server/scripts/resources/probability-high-school.json`，含稳定知识点 ID、来源链接、主题、作者建议顺序和先修 ID。国内课程范围参考课标及教材体系，Math Academy 作为知识组织参考；中文正文原创，公式概念交叉参考 OpenStax。参考链接不表示教材原文复制或官方分级认证。来源版本和文件哈希随导入保存。

## 知识点与学习顺序

数学知识点复用 `KnowledgeEntity(kind=math_concept)`，通过可空 `Card.knowledgeEntityId` 关联卡片；标签存于 `KnowledgeTag`，不创建 Word 或 WordTag。稳定键形如 `math:probability:conditional-probability`。元数据保存来源与先修键/标题，复习响应的 `knowledge` 返回这些展示信息。

导入器校验先修缺失、自依赖、重复 ID/位置及循环依赖，按依赖拓扑和作者建议顺序生成 `Card.learningOrder`。只影响新卡；相同顺序用卡片 ID 排序，无顺序的卡片仍按 ID 排在其后。到期复习与日内学习继续使用原队列和 FSRS 规则，不推断掌握、不锁定卡片、不向先修知识传播评分。

首版每个知识点对应一张卡片。后台返回的学习顺序同时供 Web 和其他客户端使用；列表的主题筛选仅筛选列表，复习入口仍进入完整牌组队列。Web 显示高中和主题标签，详情可查看先修知识点及来源。牌组初始配置为每天 3 张新卡、手动显示答案、关闭音频自动播放，时区继承统一设置；用户修改后重复导入不会重置配置。

## 导入与核查

在宿主机上运行，先备份并迁移数据库副本：

```sh
DATABASE_URL=file:/absolute/copy.db node server/node_modules/prisma/build/index.js \
  db push --skip-generate --schema server/prisma/schema.prisma
node server/scripts/import-probability.js --db /absolute/copy.db \
  --report server/scripts/data/probability/preview.json
node server/scripts/import-probability.js --db /absolute/copy.db \
  --report server/scripts/data/probability/applied.json \
  --apply --backup /absolute/new-backup.db
python3 server/scripts/verify-probability-import.py \
  --before /absolute/new-backup.db --after /absolute/copy.db \
  --manifest server/scripts/data/probability/applied.json \
  --output server/scripts/data/probability/verification.json
```

省略 `--apply` 只预演；应用要求新备份路径。正式迁移前停止写入，保留迁移前备份，先在副本完成检查。核查器逐行比较原有表和列（包括学习、词库、音频和配置），约束新增内容只能属于概率牌组，并验证完整性与外键。数据库备份不包含媒体文件，恢复时应同时保留媒体；恢复学习后不要用整库备份覆盖后续记录。

同一资源重复导入不会重复建卡或修改学习状态。已存在的知识点、卡片内容、标签或顺序与资源不符时，整批拒绝，不覆盖用户笔记。更新资源版本、增补知识点或调整先修关系时，需准备明确的内容迁移；不能直接编辑资源后期待旧卡自动覆盖。

运行报告和备份写入已忽略的本地数据目录，不提交 Git。

## 接口与验证

- `GET /api/decks` 返回牌组 `subject` 和阶段 `tags`。
- `GET /api/decks/:id/topics` 返回主题及卡片数。
- `GET /api/decks/:id/cards?sort=learningOrder&dir=asc&topic=<主题键>` 支持学习顺序与主题筛选。
- 卡片详情、队列、评分及撤销响应附带 `knowledge`、`learningOrder`。现有卡片编辑接口不接受修改知识点身份和学习顺序。

```sh
node --test server/scripts/tests/probability.cjs server/scripts/tests/due-order.cjs
node server/scripts/tests/probability-browser.cjs http://127.0.0.1:9000 <牌组ID>
```

浏览器测试默认只读，覆盖所有卡片公式预览、先修顺序、主题筛选，以及桌面/手机上的知识卡展示。评分与撤销检查仅允许显式设置 `FLASHNEXT_ALLOW_TEST_WRITES=1`、`PROBABILITY_TEST_DB=<副本路径>` 并连接 `127.0.0.1:19008` 的预览服务。
