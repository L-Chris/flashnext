import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'
import { dueVisibleWhere } from 'app/modules/cards/infrastructure/due-filter'

@Service()
export class DeckRepository {
  list() {
    return prisma.deck.findMany({ orderBy: { createdAt: 'desc' } })
  }

  findById(id: number) {
    return prisma.deck.findUnique({ where: { id } })
  }

  create(name: string, description: string) {
    return prisma.deck.create({ data: { name, description } })
  }

  remove(id: number) {
    return prisma.deck.delete({ where: { id } })
  }

  countDue(id: number, now: Date = new Date()) {
    return prisma.card.count({ where: { deckId: id, AND: [dueVisibleWhere(now)] } })
  }
}
