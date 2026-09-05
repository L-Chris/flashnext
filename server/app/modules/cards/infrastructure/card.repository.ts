import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'

@Service()
export class CardRepository {
  listByDeck(deckId: number) {
    return prisma.card.findMany({
      where: { deckId },
      orderBy: { createdAt: 'desc' },
      include: { word: { include: { tags: true } } },
    })
  }

  listDue(deckId: number) {
    return prisma.card.findMany({
      where: { deckId, due: { lte: new Date() } },
      orderBy: { due: 'asc' },
    })
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
