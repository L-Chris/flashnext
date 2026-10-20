import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'
import { SettingsService } from 'app/modules/settings/application/settings.service'
import { ensureDeckConfig } from '../../../../scripts/lib/deck-config'
import { dueVisibleWhere } from 'app/modules/cards/infrastructure/due-filter'

@Service()
export class DeckRepository {
  constructor(private settingsService: SettingsService) {}
  list() {
    return prisma.deck.findMany({ orderBy: { createdAt: 'desc' } })
  }

  findById(id: number) {
    return prisma.deck.findUnique({ where: { id } })
  }

  async create(name: string, description: string, language = 'en') {
    const deck = await prisma.deck.create({ data: { name, description, language } })
    await ensureDeckConfig(prisma, deck.id)
    return deck
  }

  remove(id: number) {
    return prisma.deck.delete({ where: { id } })
  }

  async countDue(id: number, now: Date = new Date()) {
    return prisma.card.count({ where: { deckId: id, AND: [dueVisibleWhere(now, await this.settingsService.get(id))] } })
  }
}
