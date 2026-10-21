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

// Study responses omit dictionary-only fields; romaji remains available to search.
const WORD_DISPLAY_OMIT = { sourceMetadata: true, romaji: true } as const

@Service()
export class CardRepository {
  listByDeck(deckId: number) {
    return prisma.card.findMany({
      where: { deckId },
      orderBy: { createdAt: 'desc' },
      include: { media: { include: { asset: true }, orderBy: [{ side: 'asc' }, { position: 'asc' }] }, word: { omit: WORD_DISPLAY_OMIT, include: { tags: true, pronunciations: { where: { status: 'accepted' } } } } },
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

  // 排序/搜索用的轻量行：保留罗马音供搜索，响应通过 listByIds 单独加载。
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
          omit: WORD_DISPLAY_OMIT,
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
