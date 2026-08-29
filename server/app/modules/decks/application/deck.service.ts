import { Service } from 'typedi'
import { DeckRepository } from '../infrastructure/deck.repository'

@Service()
export class DeckService {
  constructor(private deckRepository: DeckRepository) {}

  async listDecks() {
    const decks = await this.deckRepository.list()
    const withDue = await Promise.all(
      decks.map(async deck => ({
        ...deck,
        dueCount: await this.deckRepository.countDue(deck.id),
      })),
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
