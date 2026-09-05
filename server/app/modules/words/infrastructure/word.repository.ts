import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'

const tagFilter = (scheme: string, level?: number) => ({
  scheme,
  ...(level === undefined ? {} : { level }),
})

@Service()
export class WordRepository {
  countTagged(scheme: string, level?: number) {
    return prisma.word.count({ where: { tags: { some: tagFilter(scheme, level) } } })
  }

  countTaggedWithCard(scheme: string, level?: number) {
    return prisma.word.count({
      where: { tags: { some: tagFilter(scheme, level) }, cards: { some: {} } },
    })
  }

  countTaggedStudied(scheme: string, level?: number) {
    return prisma.word.count({
      where: {
        tags: { some: tagFilter(scheme, level) },
        cards: { some: { reps: { gt: 0 } } },
      },
    })
  }

  countTaggedDue(scheme: string, level?: number) {
    return prisma.word.count({
      where: {
        tags: { some: tagFilter(scheme, level) },
        cards: { some: { due: { lte: new Date() } } },
      },
    })
  }

  countUntagged(scheme: string) {
    return prisma.word.count({ where: { tags: { none: { scheme } } } })
  }

  countUntaggedWithCard(scheme: string) {
    return prisma.word.count({
      where: { tags: { none: { scheme } }, cards: { some: {} } },
    })
  }

  countUntaggedStudied(scheme: string) {
    return prisma.word.count({
      where: { tags: { none: { scheme } }, cards: { some: { reps: { gt: 0 } } } },
    })
  }

  countUntaggedDue(scheme: string) {
    return prisma.word.count({
      where: { tags: { none: { scheme } }, cards: { some: { due: { lte: new Date() } } } },
    })
  }

  findTaggedWithoutCard(scheme: string, level?: number) {
    return prisma.word.findMany({
      where: {
        tags: { some: tagFilter(scheme, level) },
        NOT: { cards: { some: {} } },
      },
      orderBy: { rank: { sort: 'asc', nulls: 'last' } },
    })
  }

  findAllWithoutCard() {
    return prisma.word.findMany({
      where: { NOT: { cards: { some: {} } } },
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
    return prisma.word.findMany({ where: { headword: { in: headwords } } })
  }
}
