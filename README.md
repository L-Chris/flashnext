# FlashNext

> **本项目由 Qwen3.8 Max 开发**

面向 AI 时代的个人认知数据库（Personal Cognitive Database）与记忆系统。

FlashNext 不再只把数据建模为「牌组 → 卡片 → 复习」，而是记录**用户知道什么、掌握到什么程度、为什么认为掌握，以及是否需要继续维护记忆**。闪卡和 FSRS 是其中一种记忆机制，而不是整个知识模型本身。

当前第一阶段以英语词汇为主要落地领域：在保留完整 Anki/FSRS 式复习能力的同时，引入统一知识实体和个人知识状态，并提供面向阅读器、Agent、MCP 等外部系统的语义化查询接口。后续计划扩展数学知识、阅读记录、技能与其他结构化知识。

## 核心架构

FlashNext 将知识本身、用户状态和记忆机制分离：

```text
Knowledge Entity
知识是什么
      │
      ▼
Personal Knowledge State
用户与这个知识的关系
      │
      ├───────────────┐
      ▼               ▼
Evidence          Memory Policy
为什么这样判断      如何维护
                      │
             ┌────────┼────────┐
             ▼        ▼        ▼
          PERMANENT  FSRS  ASSESSMENT
                      │
                      ▼
                    Card
                      │
                      ▼
                  ReviewLog
```

核心原则：

- **Knowledge ≠ Card**：单词、数学概念、书籍等是知识/资源实体；卡片只是可选的学习表现形式。
- **知识与个人状态分离**：`derive`、链式法则或某本书是客观实体；“我会不会”“我是否读过”属于个人状态。
- **FSRS 只负责调度**：`Card`、`ReviewLog`、stability、difficulty 等继续作为记忆引擎的数据，不直接暴露为 Agent 的认知模型。
- **Agent 消费语义状态**：外部系统查询 `KNOWN / LEARNING / UNKNOWN` 等状态，而不是理解 FSRS 内部字段。
- **领域保持强类型**：统一实体层只提供身份和关联，不把 Word、Math、Book 全部塞进一个万能 JSON 表。
- **渐进迁移**：现有 Word/Card/ReviewLog 数据保持兼容，新知识层可以逐步回填。

当前已实现：

```text
Profile
  │
  └── PersonalKnowledgeState
             │
             ▼
      KnowledgeEntity
             │
             ▼
            Word
             │
             └── optional Card → FSRS → ReviewLog
```

后续领域规划：

```text
KnowledgeEntity
├── Word                    # 已实现
├── MathKnowledge           # 计划：概念/定理/公式/技巧 + prerequisite 关系
├── Book                    # 计划：书籍实体 + ReadingRecord
├── Skill                   # 计划
└── Note / Fact             # 计划
```

### 个人知识状态

`PersonalKnowledgeState` 描述用户和某个 `KnowledgeEntity` 的关系。

当前词汇状态：

| 状态 | 含义 |
|---|---|
| `UNKNOWN` | 未知或没有学习证据 |
| `EXPOSED` | 已进入学习系统，但尚未形成有效复习记录 |
| `LEARNING` | 学习 / 重学阶段 |
| `KNOWN` | 已有稳定掌握证据 |
| `MASTERED` | 高稳定度掌握 |

记忆策略 `memoryPolicy` 用于把“知识状态”和“复习机制”解耦：

| 策略 | 含义 |
|---|---|
| `NONE` | 只保存知识，不维护个人记忆状态 |
| `PERMANENT` | 作为长期知识保存，不主动安排间隔重复 |
| `FSRS` | 使用现有 Card + FSRS 调度维护 |
| `ASSESSMENT` | 预留：通过测验、练习、Agent 对话等重新评估 |

目前英语词汇使用 `FSRS`。未来数学知识可以默认使用 `PERMANENT` 或 `ASSESSMENT`，不需要为了进入第二大脑而强制生成闪卡。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Koa + routing-controllers + typedi + Prisma (SQLite) + TypeScript |
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| 认知层 | KnowledgeEntity + PersonalKnowledgeState + Domain Models |
| 记忆算法 | FSRS-6 调度（ts-fsrs）+ fsrs-rs 官方参数训练（`@open-spaced-repetition/binding`，napi/WASI） |
| 容器 | node:25-alpine 多阶段构建 |

后端架构参考 `mishu-service`：Koa + routing-controllers 装饰器路由、typedi 依赖注入、controllers → modules(application/infrastructure) 分层、esbuild 打包。

## 目录结构

```text
flashnext/
├── Dockerfile                 # 多阶段构建（web → server → runtime）
├── docker-compose.yml
├── .dockerignore
├── docs/
│   └── cognitive-memory.md    # 认知层实现/迁移补充说明
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
│   │   └── schema.prisma      # Profile / Knowledge / Word / Deck / Card / ReviewLog / FsrsParam
│   └── app/
│       ├── controllers/       # deck / card / fsrs / word / knowledge controller
│       ├── shared/
│       │   ├── prisma.ts
│       │   └── day-boundary.js    # 日切点 / learn-ahead 时间语义（后端与脚本共用）
│       └── modules/
│           ├── knowledge/     # 统一知识实体、个人知识状态、Agent 查询投影
│           ├── words/         # word.service + tag.registry + word.repository
│           ├── decks/         # deck.service + deck.repository
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

### 认知层

```prisma
model Profile {
  id, name, createdAt, updatedAt,
  knowledgeStates[]
}

model KnowledgeEntity {
  id,
  kind,            # word / future math_concept / book / skill ...
  canonicalKey,    # 稳定唯一身份，如 en:word:derive
  title,
  summary,
  states[],
  word?
}

model PersonalKnowledgeState {
  profileId,
  entityId,
  memoryPolicy,    # NONE / PERMANENT / FSRS / future ASSESSMENT
  status,          # UNKNOWN / EXPOSED / LEARNING / KNOWN / MASTERED
  confidence,      # 0..1，面向 Agent 的语义置信度
  firstSeenAt,
  lastEvidenceAt
}

model Word {
  id,
  knowledgeEntityId?,
  headword,
  rank,
  pos,
  phonetic,
  translation,
  tags[],
  cards[]
}
```

`KnowledgeEntity` 是统一身份层，不承载各领域全部字段。例如英语词汇详情仍保存在 `Word`，未来数学公式和前置知识保存在独立的数学表，书籍元数据保存在独立的 `Book` 表。

`Word.knowledgeEntityId` 当前故意保持可空，使已有 SQLite 数据库可以先执行 `prisma db push`，再通过幂等同步逐步回填，不要求一次性迁移所有历史数据。

### 记忆引擎

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

这里 `Card / ReviewLog / FsrsParam` 仍然是 FSRS 调度的 source of truth；`PersonalKnowledgeState` 是供用户界面和 Agent 消费的语义投影，两者职责不同。

## API

统一响应格式：`{ message: 'ok', data: ... }`。

### 认知 / Agent API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/knowledge/profile` | 默认 Profile + 已收录知识、已跟踪知识、已知知识统计 |
| POST | `/api/knowledge/sync/words` | 幂等回填 Word → KnowledgeEntity，并将当前 Card/FSRS 状态投影到个人知识状态 |
| POST | `/api/knowledge/vocabulary/check` | 批量查询单词的语义状态、置信度、记忆策略、词频排名和标签 |
| GET | `/api/knowledge/vocabulary/profile` | 返回词汇库总量、已跟踪量、已掌握量和各语义状态统计 |

词汇查询示例：

```http
POST /api/knowledge/vocabulary/check
Content-Type: application/json

{
  "words": ["derive", "mitigate", "ephemeral"]
}
```

外部 Agent 不需要理解 `stability`、`difficulty`、`state=2` 等调度内部实现，而可以得到类似：

```json
[
  {
    "headword": "derive",
    "status": "KNOWN",
    "confidence": 0.8,
    "memoryPolicy": "FSRS",
    "rank": 1234,
    "tags": []
  }
]
```

这组接口是未来 MCP / Plugin / 阅读器集成的基础。长期计划继续增加：

```text
vocabulary_analyze_text(...)
math_get_profile(...)
books_has_read(...)
knowledge_search(...)
```

### 闪卡 / 复习 API

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

## 英语词汇领域

英语词汇是当前第一个完整接入认知层的 Domain。

数据关系：

```text
KnowledgeEntity(kind=word)
        │
        ├── PersonalKnowledgeState
        │      └── UNKNOWN / EXPOSED / LEARNING / KNOWN / MASTERED
        │
        └── Word
             ├── COCA / CET tags
             └── Card → FSRS
```

### COCA 分级词库

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

### 单卡组与多标签体系

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
| GET | `/api/words/coverage?scheme=coca` | 旧版卡片覆盖视图：词数/已建卡/已学/待复习/覆盖率 + 未收录行 |
| POST | `/api/words/cards/ensure` | `{ scheme?, level? }` 单卡组补建缺卡单词并同步旧卡内容（幂等） |

> `/api/words/coverage` 仍保持兼容，但它衡量的是**卡片覆盖**而不是新的**认知覆盖**。后续前端会逐步迁移到 `PersonalKnowledgeState` 的语义状态统计。

历史迁移：`node scripts/migrate-single-deck.js`（旧按级卡组 → 单卡组，同词多卡合并、
日志改指向、band 列 → coca 标签）。

### 从现有词库建立认知层

升级数据库后执行一次：

```http
POST /api/knowledge/sync/words
```

该操作幂等，会：

1. 为每个 Word 创建或更新 `KnowledgeEntity(kind=word)`；
2. 将 Word 链接到统一实体；
3. 为默认 Profile（当前单用户模式固定 `id = 1`）创建/更新 `PersonalKnowledgeState`；
4. 从最佳现有 Card/FSRS 状态投影为 Agent 友好的 `UNKNOWN / EXPOSED / LEARNING / KNOWN / MASTERED`。

当前映射是第一版启发式语义投影，FSRS 调度数据本身不会被修改。后续计划在 review / undo 后即时刷新状态，并逐步引入更可靠的 evidence 模型。

## 未来领域设计

### 数学

数学知识不会直接建模成传统 front/back Card，而计划采用强类型结构：

```text
MathKnowledge
├── kind: CONCEPT / THEOREM / FORMULA / TECHNIQUE / PROBLEM_TYPE
├── domain / subdomain
├── definition
├── intuition
├── notation
└── conditions

KnowledgeRelation
├── PREREQUISITE
├── PART_OF
├── RELATED_TO
├── GENERALIZES
├── SPECIAL_CASE_OF
└── USED_BY
```

例如：

```text
函数 → 极限 → 导数 → 链式法则 → 多元微积分 → Jacobian
```

这样 Agent 可以判断解释某个主题时用户已经具备哪些前置知识，而不是只获得一个粗粒度的“本科数学水平”。数学知识可以默认 `PERMANENT`，未来再通过 `ASSESSMENT` 对理解、应用、推导能力进行细化。

### 书籍与阅读

书籍将作为资源/经历，而不是闪卡：

```text
Book
└── ReadingRecord
    ├── WANT_TO_READ
    ├── READING
    ├── READ
    └── ABANDONED
```

“读过一本书”和“掌握书中的某个概念”会保持为两种独立事实，避免 Agent 因为阅读记录而过度推断能力。未来可以通过 `learned_from` 等关系把概念、摘录和书籍连接起来。

### Evidence

长期计划加入统一 Evidence 层，用于回答“系统为什么认为用户知道这个”：

```text
MANUAL     用户手动确认
REVIEW     FSRS 复习记录
QUIZ       测试结果
IMPORT     Anki / 外部系统导入
READING    阅读行为
AGENT      Agent 推断（低信任，不应直接永久改写状态）
```

现有 `ReviewLog` 继续作为 FSRS 的原始复习证据，不需要搬入通用 Evidence 表。

## 调度时间语义（对齐 Anki）

调度时间实现在 `server/app/shared/day-boundary.js`（后端与脚本共用同一份实现），
与 fsrs-rs `convert.rs::convert_to_date` 的公式逐条等价（已用 4000 张随机卡历史做过对照验证）：

```text
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

导入/重建完成后，如需让认知层立即反映现有词汇状态，再执行一次：

```http
POST /api/knowledge/sync/words
```

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

首次升级到认知层 schema 后，启动服务并执行一次：

```http
POST /api/knowledge/sync/words
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

升级已有数据库后，`knowledgeEntityId` 可以保持为空，不会阻塞启动；通过 `/api/knowledge/sync/words` 可按需完成幂等回填。

## Roadmap

近期优先级：

1. review / undo 后即时刷新词汇 `PersonalKnowledgeState`；
2. 将 WordsView 从“卡片覆盖率”迁移为 `UNKNOWN / LEARNING / KNOWN / MASTERED` 认知覆盖；
3. 增加文本词汇分析 API，供阅读器判断未知词和可读性；
4. 增加数学 `MathKnowledge + KnowledgeRelation + MathMastery`；
5. 增加 `Book + ReadingRecord`；
6. 引入 Evidence 层；
7. 增加 Agent read scopes，并提供 MCP / Plugin Adapter。

最终目标不是做一个拥有更多 Card Type 的 Anki，而是维护可供人和 AI 长期使用的 **User Cognitive Profile**：

```text
Vocabulary Model
+
Math Knowledge Graph
+
Reading History
+
Knowledge / Skill State
+
Learning Evidence
          │
          ▼
Personal Cognitive Database
          │
          ▼
Reader / Agent / MCP / AI Assistant
```
