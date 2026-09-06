import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'

export interface RevlogRow {
  id: number
  cardId: number
  rating: number
  reviewAt: Date
  state: number
  interval: number
  stability: number
  difficulty: number
  durationMs: number
  repsBefore: number
  lapsesBefore: number
  learningStepsBefore: number
  dueBefore: Date | null
}

const REVLOG_CSV_HEADER = 'review_time,card_id,review_rating,review_duration,review_state'

@Service()
export class FsrsRepository {
  getParamRow() {
    return prisma.fsrsParam.findUnique({ where: { id: 1 } })
  }

  saveParams(w: number[], source: string) {
    return prisma.fsrsParam.upsert({
      where: { id: 1 },
      update: { w: JSON.stringify(w), source, updatedAt: new Date() },
      create: { id: 1, w: JSON.stringify(w), source },
    })
  }

  markRevlogMigrated() {
    return prisma.fsrsParam.upsert({
      where: { id: 1 },
      update: { revlogMigratedAt: new Date() },
      create: { id: 1, w: '[]', revlogMigratedAt: new Date() },
    })
  }

  /**
   * 落一条复习日志。除了训练用的 review_state，还记录复习前的完整快照，
   * 使「撤销上一次评分」可以精确回滚（对应 Anki 的 undo）。
   */
  createLog(
    rating: number,
    durationMs: number,
    card: {
      id: number
      state: number
      interval: number
      stability: number
      difficulty: number
      reps: number
      lapses: number
      learningSteps: number
      due: Date
    },
  ) {
    return prisma.reviewLog.create({
      data: {
        cardId: card.id,
        rating,
        durationMs,
        state: card.state,
        interval: card.interval,
        stability: card.stability,
        difficulty: card.difficulty,
        repsBefore: card.reps,
        lapsesBefore: card.lapses,
        learningStepsBefore: card.learningSteps,
        dueBefore: card.due,
      },
    })
  }

  lastLogOf(cardId: number) {
    return prisma.reviewLog.findFirst({ where: { cardId }, orderBy: { reviewAt: 'desc' } })
  }

  deleteLog(id: number) {
    return prisma.reviewLog.delete({ where: { id } })
  }

  countLogs() {
    return prisma.reviewLog.count()
  }

  listLogsBetween(from: Date, to: Date) {
    return prisma.reviewLog.findMany({
      where: { reviewAt: { gte: from, lt: to } },
      select: { cardId: true, state: true },
    })
  }

  listAllLogs() {
    return prisma.reviewLog.findMany({
      orderBy: [{ cardId: 'asc' }, { reviewAt: 'asc' }],
    })
  }

  updateLogStates(updates: Array<{ id: number; state: number; interval: number; stability: number; difficulty: number }>) {
    return Promise.all(
      updates.map(u =>
        prisma.reviewLog.update({
          where: { id: u.id },
          data: { state: u.state, interval: u.interval, stability: u.stability, difficulty: u.difficulty },
        }),
      ),
    )
  }

  /**
   * fsrs-rs `convertCsvToFsrsItems` 要求的 revlog CSV。
   * review_state = 复习当时卡片所处状态（0 new / 1 learning / 2 review / 3 relearning）。
   */
  async buildRevlogCsv(cardIds?: Set<number>): Promise<{ csv: string; rows: number }> {
    const logs = await prisma.reviewLog.findMany({
      orderBy: [{ cardId: 'asc' }, { reviewAt: 'asc' }],
    })
    const parts = [REVLOG_CSV_HEADER]
    let rows = 0
    let prevCardId: number | null = null
    let seenInCard = 0
    for (const log of logs) {
      if (cardIds && !cardIds.has(log.cardId)) continue
      if (log.cardId !== prevCardId) {
        prevCardId = log.cardId
        seenInCard = 0
      }
      // 首次复习记为 New，其后按存储的状态；避免全 0 历史把 revlog 裁空
      const state = seenInCard === 0 && log.state === 0 ? 0 : log.state
      parts.push(`${log.reviewAt.getTime()},${log.cardId},${log.rating},${log.durationMs},${state}`)
      seenInCard += 1
      rows += 1
    }
    return { csv: parts.join('\n') + '\n', rows }
  }
}
