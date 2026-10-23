import { Service } from 'typedi'
import { DeckRepository } from '../infrastructure/deck.repository'
import { DueService } from 'app/modules/cards/application/due.service'
import { prisma } from 'app/shared/prisma'
import { HttpError } from 'routing-controllers'

@Service()
export class DeckService {
  constructor(
    private deckRepository: DeckRepository,
    private dueService: DueService,
  ) {}

  async listDecks() {
    const decks = await this.deckRepository.list()
    const withDue = await Promise.all(
      decks.map(async deck => {
        const { dueCount, counts, usage } = await this.dueService.summary(deck.id)
        const tags = deck.subject ? await prisma.knowledgeTag.findMany({
          where: { scheme: 'education-stage', entity: { cards: { some: { deckId: deck.id } } } },
          distinct: ['scheme', 'key'], select: { scheme: true, key: true, label: true },
        }) : []
        return { ...deck, tags, dueCount, counts, usage }
      }),
    )
    return withDue
  }

  createDeck(name: string, description: string) {
    return this.deckRepository.create(name, description)
  }

  async listTopics(deckId: number) {
    if (!await this.deckRepository.findById(deckId)) throw new HttpError(404, '牌组不存在')
    const rows = await prisma.card.findMany({ where: { deckId, knowledgeEntityId: { not: null } },
      orderBy: [{ learningOrder: 'asc' }, { id: 'asc' }],
      select: { knowledgeEntity: { select: { tags: true } } } })
    const topics = new Map<string, { key: string; label: string; cardCount: number }>()
    for (const row of rows) for (const tag of row.knowledgeEntity?.tags || []) {
      if (tag.scheme !== 'probability-topic') continue
      const topic = topics.get(tag.key) || { key: tag.key, label: tag.label, cardCount: 0 }
      topic.cardCount++; topics.set(tag.key, topic)
    }
    return [...topics.values()]
  }

  async deleteDeck(id: number) {
    await this.deckRepository.remove(id)
    return true
  }
}
