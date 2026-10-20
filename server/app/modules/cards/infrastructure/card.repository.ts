import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'
import type { DayClock } from 'app/shared/day-boundary'
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
      include: { media: { include: { asset: true }, orderBy: [{ side: 'asc' }, { position: 'asc' }] }, word: { omit: { sourceMetadata: true }, include: { tags: true, pronunciations: { where: { status: 'accepted' } } } } },
    })
  }

  // 只取排序/限额所需字段，避免把整张卡拉进内存排序
  listDueCandidates(deckId: number, now: Date = new Date(), clock?: DayClock) {
    return prisma.card.findMany({
      where: { deckId, AND: [dueVisibleWhere(now, clock)] },
      select: CARD_FIELDS,
    })
  }

  countDue(deckId: number, now: Date = new Date(), clock?: DayClock) {
    return prisma.card.count({ where: { deckId, AND: [dueVisibleWhere(now, clock)] } })
  }

  // 排序/分页用的轻量行：不含释义全文与标签，word 只取 rank
  listLightByDeck(deckId: number) {
    return prisma.card.findMany({
      where: { deckId },
      select: {
        id: true,
        front: true,
        state: true,
        stability: true,
        difficulty: true,
        reps: true,
        lapses: true,
        interval: true,
        due: true,
        lastReview: true,
        createdAt: true,
        word: { select: { rank: true, translation: true, phonetic: true, reading: true, readings: true, spellings: true, romaji: true } },
      },
    })
  }

  listByIds(ids: number[]) {
    return prisma.card.findMany({
      where: { id: { in: ids } },
      include: {
        media: { include: { asset: true }, orderBy: [{ side: 'asc' }, { position: 'asc' }] },
        word: {
          omit: { sourceMetadata: true },
          include: {
            tags: true,
            senses: { orderBy: { senseIdx: 'asc' }, take: 3 },
            ieltsUsages: { orderBy: { sourceOrder: 'asc' } },
            pronunciations: { where: { status: 'accepted' }, orderBy: { id: 'asc' } },
          },
        },
      },
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
