import { Service } from 'typedi'
import { HttpError } from 'routing-controllers'
import { prisma } from 'app/shared/prisma'
import { ensureDeckConfig } from '../../../../scripts/lib/deck-config'

export interface RevlogRow {
  id: number; cardId: number; rating: number; reviewAt: Date; state: number;
  interval: number; stability: number; difficulty: number; durationMs: number;
  repsBefore: number; lapsesBefore: number; learningStepsBefore: number; dueBefore: Date | null
}
export interface ConfigVersion { settings: number; params: number }

export async function listDeckLogs(db: Pick<typeof prisma, 'card' | 'reviewLog'>, deckId: number, window?: { from: Date; to: Date }) {
  const cards = await db.card.findMany({ where: { deckId }, select: { id: true } })
  const logs: RevlogRow[] = []
  for (let i = 0; i < cards.length; i += 500) {
    logs.push(...await db.reviewLog.findMany({ where: {
      cardId: { in: cards.slice(i, i + 500).map(c => c.id) },
      ...(window ? { reviewAt: { gte: window.from, lt: window.to } } : {}),
    } }))
  }
  return logs.sort((a, b) => a.cardId - b.cardId || a.reviewAt.getTime() - b.reviewAt.getTime() || a.id - b.id)
}

@Service()
export class FsrsRepository {
  async getParamRow(deckId: number) {
    const row = await prisma.deckFsrsParam.findUnique({ where: { deckId } })
    if (row) return row
    if (!await prisma.deck.findUnique({ where: { id: deckId } })) throw new HttpError(404, '牌组不存在')
    return (await ensureDeckConfig(prisma, deckId)).params
  }

  async saveParams(deckId: number, w: number[], source: string, expected?: ConfigVersion) {
    return prisma.$transaction(async tx => {
      const settings = await tx.deckSetting.findUnique({ where: { deckId } })
      const current = await tx.deckFsrsParam.findUnique({ where: { deckId } })
      if (!settings || !current) throw new HttpError(404, '牌组已删除')
      if (expected && (expected.settings !== settings.version || expected.params !== current.version)) throw new HttpError(409, '牌组设置或参数已改变，请重新训练')
      return tx.deckFsrsParam.update({ where: { deckId }, data: { w: JSON.stringify(w), source, updatedAt: new Date(), version: { increment: 1 } } })
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

  async countLogs(deckId: number) {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM review_logs r JOIN cards c ON c.id=r.card_id WHERE c.deck_id=${deckId}`
    return Number(rows[0].n)
  }

  listLogsBetween(deckId: number, from: Date, to: Date) { return listDeckLogs(prisma, deckId, { from, to }) }
  listAllLogs(deckId: number) { return listDeckLogs(prisma, deckId) }

  async buildRevlogCsv(deckId: number, cardIds?: Set<number>) {
    const logs = await this.listAllLogs(deckId)
    const parts = ['review_time,card_id,review_rating,review_duration,review_state']
    let rows = 0
    for (const log of logs) {
      if (cardIds && !cardIds.has(log.cardId)) continue
      parts.push(`${log.reviewAt.getTime()},${log.cardId},${log.rating},${log.durationMs},${log.state}`)
      rows++
    }
    return { csv: parts.join('\n') + '\n', rows }
  }
}
