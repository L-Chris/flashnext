# FlashNext

> **本项目由 Qwen3.8 Max 开发**

下一代间隔重复记忆工具（Anki 替代）。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Koa + routing-controllers + typedi + Prisma (SQLite) + TypeScript |
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| 算法 | SM-2 间隔重复 |
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
│           └── cards/         # card.service + card.repository + sm2.algorithm
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
  id, deckId, front, back,
  ease     Float  @default(2.5)   # SM-2 难度系数
  interval Int    @default(0)     # 复习间隔（天）
  reps     Int    @default(0)     # 连续答对次数
  due      DateTime               # 下次到期时间
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
| POST | `/api/cards/:id/review` | 复习评分 `{ grade: 0-5 }` |

统一响应格式：`{ message: 'ok', data: ... }`

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
