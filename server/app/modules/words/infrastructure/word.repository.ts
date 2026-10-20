import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'
import { TAG_SCHEMES } from './tag.registry'
import { SettingsService } from 'app/modules/settings/application/settings.service'

const languageOf = (scheme: string) => TAG_SCHEMES.find(s => s.scheme === scheme)?.language || 'en'

const tagFilter = (scheme: string, level?: number) => ({
  scheme,
  ...(level === undefined ? {} : { level }),
})

@Service()
export class WordRepository {
  constructor(private settingsService: SettingsService) {}
  countTagged(scheme: string, level?: number) {
    return prisma.word.count({ where: { language: languageOf(scheme), tags: { some: tagFilter(scheme, level) } } })
  }

  countTaggedWithCard(scheme: string, level?: number) {
    return prisma.word.count({
      where: { language: languageOf(scheme), tags: { some: tagFilter(scheme, level) }, cards: { some: {} } },
    })
  }

  countTaggedStudied(scheme: string, level?: number) {
    return prisma.word.count({
      where: {
        language: languageOf(scheme),
        tags: { some: tagFilter(scheme, level) },
        cards: { some: { reps: { gt: 0 } } },
      },
    })
  }

  async countTaggedDue(scheme: string, level?: number) {
    return prisma.word.count({
      where: {
        language: languageOf(scheme),
        tags: { some: tagFilter(scheme, level) },
        cards: { some: await this.settingsService.visibleCardsWhere() },
      },
    })
  }

  countReady(scheme: string, level: number) {
    return prisma.word.count({ where: { language: languageOf(scheme), definitionStatus: 'ready', tags: { some: tagFilter(scheme, level) } } })
  }

  countUntagged(scheme: string) {
    return prisma.word.count({ where: { language: languageOf(scheme), tags: { none: { scheme } } } })
  }

  countUntaggedWithCard(scheme: string) {
    return prisma.word.count({
      where: { language: languageOf(scheme), tags: { none: { scheme } }, cards: { some: {} } },
    })
  }

  countUntaggedStudied(scheme: string) {
    return prisma.word.count({
      where: { language: languageOf(scheme), tags: { none: { scheme } }, cards: { some: { reps: { gt: 0 } } } },
    })
  }

  async countUntaggedDue(scheme: string) {
    return prisma.word.count({
      where: { language: languageOf(scheme), tags: { none: { scheme } }, cards: { some: await this.settingsService.visibleCardsWhere() } },
    })
  }

  findTaggedWithoutCard(scheme: string, level?: number) {
    return prisma.word.findMany({
      where: {
        language: languageOf(scheme),
        tags: { some: tagFilter(scheme, level) },
        definitionStatus: 'ready',
        NOT: { cards: { some: {} } },
      },
      orderBy: { rank: { sort: 'asc', nulls: 'last' } },
    })
  }

  findAllWithoutCard() {
    return prisma.word.findMany({
      where: { language: 'en', definitionStatus: 'ready', NOT: { cards: { some: {} } } },
      orderBy: { rank: { sort: 'asc', nulls: 'last' } },
    })
  }

  listExistingTags(scheme: string) {
    return prisma.wordTag.findMany({
      where: { scheme },
      select: { wordId: true, level: true },
    })
  }

  createTags(rows: { wordId: number; scheme: string; level: number; label: string }[]) {
    return prisma.wordTag.createMany({ data: rows })
  }

  findWordsByHeadwords(headwords: string[]) {
    return prisma.word.findMany({ where: { language: 'en', headword: { in: headwords } } })
  }
}
