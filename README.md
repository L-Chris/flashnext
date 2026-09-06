# FlashNext

> **本项目由 Qwen3.8 Max 开发**

下一代间隔重复记忆工具（Anki 替代）。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Koa + routing-controllers + typedi + Prisma (SQLite) + TypeScript |
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| 算法 | FSRS-6 调度（ts-fsrs）+ fsrs-rs 官方参数训练（`@open-spaced-repetition/binding`，napi/WASI） |
| 容器 | node:25-alpine 多阶段构建 |

后端架构参考 `mishu-service`：Koa + routing-controllers 装饰器路由、typedi 依赖注入、controllers → modules(application/infrastructure) 分层、esbuild 打包。

## 目录结构

```
flashnext/
├── Dockerfile                 # 多阶段构建（web → server → runtime）
├── docker-compose.yml
├── .dockerignore
├── server/                    # 后端
│   ├── app.ts                 # 入口
│   ├── build.js               # esbuild 打包（同 mishu-service）
│   ├── configs/
│   │   ├── application.ts     # Koa + routing-controllers 装配
│   │   ├── constants.ts       # 端口 / DATABASE_URL / 静态目录 / FSRS 与调度参数
│   │   ├── koa.middlewares.ts # trace-id、logger、bodyparser、静态文件
│   │   ├── routing.options.ts # /api 前缀、validation
│   │   ├── routing.middlewares.ts  # CORS、错误中间件
│   │   └── interceptors.ts    # 统一 { message, data } 响应
│   ├── prisma/
│   │   └── schema.prisma      # Deck / Card / Word / ReviewLog / FsrsParam
│   └── app/
│       ├── controllers/       # deck / card / fsrs / word controller
│       ├── shared/
│       │   ├── prisma.ts
│       │   └── day-boundary.js    # 日切点 / learn-ahead 时间语义（后端与脚本共用）
│       └── modules/
│           ├── decks/         # deck.service + deck.repository
│           ├── words/         # word.service + tag.registry + word.repository
│           ├── fsrs/
│           │   ├── application/   # optimizer.service（fsrs-rs + 护栏）/ rebuild.service（全量重放）
│           │   └── infrastructure/# fsrs.repository（revlog CSV / 参数 / 训练前置）
│           └── cards/
│               ├── application/   # card.service / due.service（队列·限额·排序）/ fsrs.scheduler
│               └── infrastructure/# card.repository / due-filter（可见性谓词）
└── web/                       # 前端
    ├── vite.config.ts         # dev 时 /api 代理到 :3000
    └── src/
        ├── App.tsx            # 视图状态机（牌组列表 / 牌组详情 / 复习）
        ├── api/client.ts      # REST 客户端
        └── components/        # DeckForm / DeckList / DeckDetail / CardForm / CardList /
                               # ReviewView（撤销·限额提示）/ FsrsPanel / WordsView
```

## 数据模型

```prisma
model Deck {
  id, name, description, createdAt, cards[]
}

model Card {
  id, deckId, wordId?, front, back,
  stability  Float  @default(0)   # FSRS 记忆稳定性（天）
  difficulty Float  @default(0)   # FSRS 难度
  state      Int    @default(0)   # 0 New / 1 Learning / 2 Review / 3 Relearning
  reps, lapses, learningSteps, interval, due, lastReview
}

model ReviewLog {
  id, cardId, rating, reviewAt,
  state, interval, stability, difficulty,   # 复习「当时」的记忆状态：fsrs-rs 训练所需的 review_state
  durationMs,                               # 答题耗时
  repsBefore, lapsesBefore, learningStepsBefore, dueBefore   # 复习前快照，用于精确撤销
}

model FsrsParam {
  id=1, w(JSON), updatedAt,
  source,             # default / manual / official-fsrs-rs / official-forced / legacy
  revlogMigratedAt    # review_state 是否已回填（训练前置条件）
}
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/decks` | 牌组列表（含待复习数） |
| POST | `/api/decks` | 创建牌组 |
| DELETE | `/api/decks/:id` | 删除牌组 |
| GET | `/api/decks/:id/cards` | 卡片列表 |
| GET | `/api/decks/:id/cards/due` | 复习队列 `{ cards, usage, counts }`（见「调度时间语义」） |
| POST | `/api/decks/:id/cards` | 添加卡片 |
| DELETE | `/api/cards/:id` | 删除卡片 |
| POST | `/api/cards/:id/review` | 复习评分 `{ rating: 1-4, durationMs? }`（Again/Hard/Good/Easy） |
| POST | `/api/cards/:id/undo` | 撤销该卡最近一次评分（按复习前快照精确回滚） |

统一响应格式：`{ message: 'ok', data: ... }`

## COCA 分级词库

内置 COCA Top 5000 英语词库，按使用频率分级，可一键生成学习卡组。

| 等级 | COCA 排名 | 名称 | 词条数 |
|---|---|---|---|
| L1 | 1-1000 | 核心高频 | 1000 |
| L2 | 1001-3000 | 常用 | 2000 |
| L3 | 3001-5000 | 进阶 | 2000 |

数据来源（不入库，需自行下载到 `server/scripts/data/`）：

- 排名：`mahavivo/english-wordlists` → `COCA_20000.txt`（行号即 COCA 排名）
- 中文释义：`skywind3000/ECDICT` → `ecdict.csv`（66MB），并过滤 `[计]`/`[医]` 等领域标签义项
- 美式 KK 音标：`Alexir/CMUdict` → `cmudict-0.7b`（ARPAbet 转 KK，缺失时回退 ECDICT 英式）
- 释义兜底：`mahavivo/english-wordlists` → `COCA_with_translation.txt`

导入（幂等，可重复执行）：

```bash
cd server
node scripts/import-words.js 5000
```

## 单卡组与多标签体系

所有单词卡片集中于唯一卡组「英语单词」；分级/考试体系作为**标签**挂在单词上
（`word_tags` 表：scheme + level + label），体系元数据在
`server/app/modules/words/infrastructure/tag.registry.ts` 注册，新增体系无需改表。

已注册体系：

- `coca`：L1-L5（由 COCA 排名换算）
- `cet`：CET-4 / CET-6（`node scripts/import-cet.js` 导入词表标签）

词库 API：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/words/tags` | 标签体系注册表 + 各体系 tagged 词数 |
| GET | `/api/words/coverage?scheme=coca` | 每级覆盖度：词数/已建卡/已学/待复习/覆盖率 + 未收录行 |
| POST | `/api/words/cards/ensure` | `{ scheme?, level? }` 单卡组补建缺卡单词并同步旧卡内容（幂等） |

历史迁移：`node scripts/migrate-single-deck.js`（旧按级卡组 → 单卡组，同词多卡合并、
日志改指向、band 列 → coca 标签）。

## 调度时间语义（对齐 Anki）

调度时间实现在 `server/app/shared/day-boundary.js`（后端与脚本共用同一份实现），
与 fsrs-rs `convert.rs::convert_to_date` 的公式逐条等价（已用 4000 张随机卡历史做过对照验证）：

```
dayIndex(ms) = floor((ms + tz_offset_minutes*60_000 - ROLLOVER_HOUR*3_600_000) / 86_400_000)
```

- **日切点**：默认 `Asia/Shanghai` 每天 04:00（Anki 默认 rollover）。`due = cutStart + interval 天`，
  即到期时间落在切点上，而不是 ts-fsrs 默认的「复习时刻 + interval×24h」。
- **elapsed_days**：按日切点整天差计算，不再用 ts-fsrs 的 `dateDiffInDays`（它按 UTC 自然日，
  等于把日界放在本地 08:00）。
- **日内学习步骤**：仍以真实复习时刻为基准（10m 就是 10 分钟后），并套用 Anki 的
  Day Boundaries 规则：delay 一旦跨过下一个切点就换算成整天。
- **fuzz**：`enable_fuzz: true`（Anki 对复习卡强制加 fuzz，ts-fsrs 默认关闭），
  种子用 `GenSeedStrategyWithCardId('id')`，同一张卡同一 reps 结果可复现（撤销后可还原）。
- **队列可见性**：过了切点当天全部可见；日内学习/新卡额外提供 20 分钟 learn-ahead。
- **每日限额**：默认 new/day=20、review/day=200，按「复习当时卡片状态」统计当天用量。
- **排序**：Anki 的 gather 顺序 —— 日内学习卡 → 复习卡（按 retrievability 升序）→ 新卡。

`GET /api/decks/:id/cards/due` 返回 `{ cards, usage, counts }`：`usage` 是当天限额用量，
`counts` 是 `{ intraday, review, fresh, queued, hiddenByLimit }`。

可调环境变量（`docker-compose.yml` 已透传，均可省略）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `FLASHNEXT_TZ` | `Asia/Shanghai` | 日切点所属时区 |
| `FLASHNEXT_ROLLOVER_HOUR` | `4` | 日切点小时 |
| `FLASHNEXT_LEARN_AHEAD_MINUTES` | `20` | 学习卡提前展示窗口 |
| `FLASHNEXT_NEW_PER_DAY` | `20` | 每日新卡上限 |
| `FLASHNEXT_REVIEWS_PER_DAY` | `200` | 每日复习上限 |
| `FLASHNEXT_DESIRED_RETENTION` | `0.9` | 期望保持率（同 Anki desired retention） |
| `FLASHNEXT_MAXIMUM_INTERVAL` | `36500` | 最大间隔（天）。复习量太少时可下调（如 365）换取更高保持率 |
| `FLASHNEXT_OPTIMIZE_TIMEOUT_MS` | `120000` | fsrs-rs 训练时间预算 |

## FSRS 参数训练

不再自研优化器（旧版坐标下降会把 `w[6]/w[7]/w[20]` 顶到 clip 边界，导致 interval 爆炸）。
现在直接调用官方 fsrs-rs：

1. 每次评分写入 `review_logs`，同时记录复习当时的 `state`（0/1/2/3）与复习前快照
2. 训练时把 revlog 拼成 fsrs-rs 要求的 CSV（`review_time,card_id,review_rating,review_duration,review_state`），
   交给 `convertCsvToFsrsItems` 生成训练集 —— 复习前缀展开、按最后一个学习块裁剪、
   delta_t 用日切点整天差，全部由官方实现负责
3. `computeParameters({ enableShortTerm: true, numRelearningSteps: 1 })` 训练 `w`，需 ≥1000 条复习日志
4. **准入护栏只有一条**：`evaluate()` 的 logLoss / rmseBins 不得比 FSRS-6 默认参数差；
   未通过则**不写库**，把诊断返回给前端（`force` 可强制采用）。其余完全跟随官方行为：
   clip 后照用、训练结果照存

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/fsrs/params` | 当前 w / 来源 / 日切点时区 / 日志数 / review_state 是否已回填 |
| POST | `/api/fsrs/params` | `{ w? }` 写入参数；不传 `w` 即重置为 FSRS-6 官方默认值 |
| POST | `/api/fsrs/optimize` | `{ force?, timeoutMs? }` 启动后台训练（立即返回；训练是分钟级任务，走同步 HTTP 会被反代 60s 超时掐断） |
| GET | `/api/fsrs/optimize` | 训练任务状态 `{ running, result: { saved, w, audit }, error }`，前端轮询 |
| POST | `/api/fsrs/rebuild` | `{ dryRun? }` 全量重放复习历史：重建记忆状态、把 `due` 对齐日切点、回填 `review_state` |
| GET | `/api/fsrs/rebuild` | 重建任务进度与结果（今日到期变化、interval 分位数、未来 30 天 due 预报） |

> 训练数据来自别的调度器（例如从 Anki 导入的历史）时，官方优化器可能给出 metrics 更优、
> 但 interval 明显偏长的解（例如新卡 Good 就有 48 天 stability）。metrics 护栏不会拦这种解，
> 训练后卡片间隔变长属于预期行为；想回到默认值用 `POST /api/fsrs/params`（不传 `w`）重置。

测试数据：`node scripts/seed-review-logs.js` 可模拟复习历史（之后需跑一次 rebuild 回填 state）。

## Anki 记忆记录导入

通过 AnkiConnect（需 Anki 运行中）导入复习历史与记忆状态：

```bash
cd server
node scripts/import-anki.js "1-考研-英语单词"   # 牌组名可省略，默认此值
```

流程：

1. 遍历目标牌组全部子牌组（`cardReviews` 仅精确匹配牌组名），合并 revlog
   （行格式 `[时间戳ms, cid, usn, ease, ivl, lastIvl, factor, 耗时, type]`，
   ease 1-4 即 FSRS rating；过滤 ease=0 撤销与 type=3 过滤牌组）
2. 笔记字段按名提取（单词/voca/正面、音标/Symbol、解释/Chn/背面，加密字段跳过）
   匹配词库（大小写不敏感）；**有复习历史的未匹配词自动建 Word（rank 空、无 coca 标签）+ 卡片**
   （无历史的库外词跳过），全部进入单卡组「英语单词」
3. 有复习历史但尚无卡片的词，也在单卡组补建卡片，保证历史不丢
4. 复习日志写入规范卡（每词最早创建的卡片），供参数优化训练
5. revlog 的 `type` 映射为 `review_state`（首次复习=0 New，type 0=1 Learning，type 2=3 Relearning，其余=2 Review），
   `耗时` 写入 `durationMs`
6. 记忆状态**不再由脚本重放**，统一交给服务端 `POST /api/fsrs/rebuild`：
   走与在线复习完全相同的调度实现（日切点对齐、fuzz、learn-ahead），保证导入与日常复习语义一致

配套脚本：`reset-memory.js`（清空记忆记录）、`cleanup-anki-import.js`（回滚导入）。

## 本地开发

```bash
# 后端
cd server
npm install
npx prisma generate && npx prisma db push
npm run dev                  # http://localhost:3000

# 前端（另开终端）
cd web
npm install
npm run dev                  # http://localhost:5173（/api 代理到 :3000）
```

## 容器化部署

```bash
docker compose up --build --detach
# 访问 http://localhost:3000
```

调度相关环境变量见「调度时间语义」一节，同样写在项目根目录 `.env` 里即可。

宿主端口可用项目根目录 `.env` 里的 `FLASHNEXT_PORT` 覆盖（默认 3000，容器内部固定监听 3000）：

```bash
echo 'FLASHNEXT_PORT=9000' > .env
docker compose up --build --detach   # 访问 http://localhost:9000
```

单容器同时提供 API 和前端构建产物，SQLite 数据持久化在宿主目录 `server/data`（挂载到 `/app/data`），启动时自动执行 `prisma db push` 同步表结构。
