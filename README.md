# FlashNext

> **本项目由 Qwen3.8 Max 开发**

下一代间隔重复记忆工具（Anki 替代）。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Koa + routing-controllers + typedi + Prisma (SQLite) + TypeScript |
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| 算法 | FSRS（ts-fsrs，同 Anki 现行算法） |
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
│   │   ├── constants.ts       # 端口 / DATABASE_URL / 静态目录
│   │   ├── koa.middlewares.ts # trace-id、logger、bodyparser、静态文件
│   │   ├── routing.options.ts # /api 前缀、validation
│   │   ├── routing.middlewares.ts  # CORS、错误中间件
│   │   └── interceptors.ts    # 统一 { message, data } 响应
│   ├── prisma/
│   │   └── schema.prisma      # Deck / Card 数据模型
│   └── app/
│       ├── controllers/       # deck.controller / card.controller
│       └── modules/
│           ├── decks/         # application(deck.service) + infrastructure(deck.repository)
│           └── cards/         # card.service + card.repository + fsrs.scheduler
└── web/                       # 前端
    ├── vite.config.ts         # dev 时 /api 代理到 :3000
    └── src/
        ├── App.tsx            # 视图状态机（牌组列表 / 牌组详情 / 复习）
        ├── api/client.ts      # REST 客户端
        └── components/        # DeckForm / DeckList / DeckDetail / CardForm / CardList / ReviewView
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
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/decks` | 牌组列表（含待复习数） |
| POST | `/api/decks` | 创建牌组 |
| DELETE | `/api/decks/:id` | 删除牌组 |
| GET | `/api/decks/:id/cards` | 卡片列表 |
| GET | `/api/decks/:id/cards/due` | 到期卡片队列 |
| POST | `/api/decks/:id/cards` | 添加卡片 |
| DELETE | `/api/cards/:id` | 删除卡片 |
| POST | `/api/cards/:id/review` | 复习评分 `{ rating: 1-4 }`（Again/Hard/Good/Easy） |

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

词库 API：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/words/bands` | 分级统计（词条数/已生成卡片数） |
| GET | `/api/words?band=1&page=1` | 分页浏览词库 |
| POST | `/api/words/decks/from-band` | `{ band: 1 }` 生成卡组+卡片（幂等） |

## FSRS 参数自优化

同 Anki 机制：基于自己的复习记录训练 FSRS 权重 `w`。

1. 每次评分写入 `review_logs`（cardId / rating / reviewAt）
2. 优化时按卡片重放复习序列：用候选 `w` 通过 ts-fsrs 重算每次复习前的 stability，
   对处于 Review 态的复习用遗忘曲线 `R(t, S)` 预测回忆概率，与真实结果（是否 Again）
   计算交叉熵损失（加 L2 正则防止偏离默认值）
3. 坐标下降搜索 `w`（clipParameters 约束边界），需 ≥1000 条复习日志
4. 结果存入 `fsrs_params`，调度器自动切换新参数

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/fsrs/params` | 当前 w / 日志数 / 优化时间 |
| POST | `/api/fsrs/optimize` | 触发优化，返回前后损失 |

测试数据：`node scripts/seed-review-logs.js` 可模拟复习历史。

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

单容器同时提供 API 和前端构建产物，SQLite 数据持久化在 `flashnext-data` 卷（`/app/data`），启动时自动执行 `prisma db push` 同步表结构。
