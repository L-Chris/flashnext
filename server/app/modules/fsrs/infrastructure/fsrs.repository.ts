import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'

export interface ReviewSeq {
  cardId: number
  ratings: number[]
  times: Date[]
}

@Service()
export class FsrsRepository {
  async getParamRow() {
    return prisma.fsrsParam.findUnique({ where: { id: 1 } })
  }

  saveParams(w: number[]) {
    return prisma.fsrsParam.upsert({
      where: { id: 1 },
      update: { w: JSON.stringify(w), updatedAt: new Date() },
      create: { id: 1, w: JSON.stringify(w) },
    })
  }

  appendLog(cardId: number, rating: number) {
    return prisma.reviewLog.create({ data: { cardId, rating } })
  }

  countLogs() {
    return prisma.reviewLog.count()
  }

  async collectSequences(): Promise<ReviewSeq[]> {
    const logs = await prisma.reviewLog.findMany({ orderBy: { reviewAt: 'asc' } })
    const byCard = new Map<number, ReviewSeq>()
    for (const log of logs) {
      let seq = byCard.get(log.cardId)
      if (!seq) {
        seq = { cardId: log.cardId, ratings: [], times: [] }
        byCard.set(log.cardId, seq)
      }
      seq.ratings.push(log.rating)
      seq.times.push(log.reviewAt)
    }
    return [...byCard.values()]
  }
}
