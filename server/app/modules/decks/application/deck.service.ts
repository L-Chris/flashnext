import { Service } from 'typedi'
import { DeckRepository } from '../infrastructure/deck.repository'
import { DueService } from 'app/modules/cards/application/due.service'

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
        return { ...deck, dueCount, counts, usage }
      }),
    )
    return withDue
  }

  createDeck(name: string, description: string) {
    return this.deckRepository.create(name, description)
  }

  async deleteDeck(id: number) {
    await this.deckRepository.remove(id)
    return true
  }
}
