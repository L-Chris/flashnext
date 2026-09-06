import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'
import { dueVisibleWhere } from './due-filter'

const CARD_FIELDS = {
  id: true,
  state: true,
  interval: true,
  due: true,
  stability: true,
  lastReview: true,
  createdAt: true,
  wordId: true,
} as const

@Service()
export class CardRepository {
  listByDeck(deckId: number) {
    return prisma.card.findMany({
      where: { deckId },
      orderBy: { createdAt: 'desc' },
      include: { word: { include: { tags: true } } },
    })
  }

  // 只取排序/限额所需字段，避免把整张卡拉进内存排序
  listDueCandidates(deckId: number, now: Date = new Date()) {
    return prisma.card.findMany({
      where: { deckId, AND: [dueVisibleWhere(now)] },
      select: CARD_FIELDS,
    })
  }

  countDue(deckId: number, now: Date = new Date()) {
    return prisma.card.count({ where: { deckId, AND: [dueVisibleWhere(now)] } })
  }

  listByIds(ids: number[]) {
    return prisma.card.findMany({
      where: { id: { in: ids } },
      include: { word: { include: { tags: true } } },
    })
  }

  listIds(deckId: number) {
    return prisma.card.findMany({ where: { deckId }, select: { id: true } })
  }

  findById(id: number) {
    return prisma.card.findUnique({ where: { id } })
  }

  create(deckId: number, front: string, back: string) {
    return prisma.card.create({ data: { deckId, front, back } })
  }

  remove(id: number) {
    return prisma.card.delete({ where: { id } })
  }

  updateScheduling(
    id: number,
    data: {
      stability: number
      difficulty: number
      state: number
      reps: number
      lapses: number
      learningSteps: number
      interval: number
      due: Date
      lastReview: Date
    },
  ) {
    return prisma.card.update({ where: { id }, data })
  }
}
