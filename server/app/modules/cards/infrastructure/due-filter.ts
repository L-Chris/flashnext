import type { Prisma } from '@prisma/client'
import { dueWindowOf } from 'app/shared/day-boundary'

// Anki 的卡片状态：0 New / 1 Learning / 2 Review / 3 Relearning
export const STATE_NEW = 0
export const STATE_LEARNING = 1
export const STATE_REVIEW = 2
export const STATE_RELEARNING = 3

// 日内卡（含新卡、学习/重学中的当天步骤）：只有进入 learn-ahead 窗口才可见。
// 跨天卡（Review 以及 interval>=1 的 interday learning）：过了日切点当天全部可见。
const intraday = { interval: 0, state: { in: [STATE_NEW, STATE_LEARNING, STATE_RELEARNING] } }

export const dueVisibleWhere = (now: Date = new Date()): Prisma.CardWhereInput => {
  const w = dueWindowOf(now)
  return {
    OR: [
      { ...intraday, due: { lte: new Date(w.learnAheadMs) } },
      { NOT: intraday, due: { lt: new Date(w.dayEndMs) } },
    ],
  }
}

export const dueWindow = (now: Date = new Date()) => dueWindowOf(now)
