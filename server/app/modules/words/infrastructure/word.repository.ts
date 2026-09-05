import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'

export interface BandMeta {
  band: number
  label: string
  range: string
  description: string
}

export const BANDS: BandMeta[] = [
  { band: 1, label: 'L1 · 核心高频', range: '1-1000', description: '覆盖日常文本约 75%' },
  { band: 2, label: 'L2 · 常用', range: '1001-3000', description: '累计覆盖约 85%' },
  { band: 3, label: 'L3 · 进阶', range: '3001-5000', description: '累计覆盖约 90%' },
  { band: 4, label: 'L4 · 扩展', range: '5001-10000', description: '六级/雅思水平' },
  { band: 5, label: 'L5 · 学术', range: '10001-20000', description: '托福/GRE 方向' },
]

@Service()
export class WordRepository {
  countByBand(band: number) {
    return prisma.word.count({ where: { band } })
  }

  countCardsByBand(band: number) {
    return prisma.card.count({ where: { word: { band } } })
  }

  listByBand(band: number, skip: number, take: number) {
    return prisma.word.findMany({
      where: { band },
      orderBy: { rank: 'asc' },
      skip,
      take,
    })
  }

  findWordsWithoutCardInDeck(deckId: number, band: number) {
    return prisma.word.findMany({
      where: {
        band,
        NOT: { cards: { some: { deckId } } },
      },
      orderBy: { rank: 'asc' },
    })
  }
}
