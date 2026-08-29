import { Service } from 'typedi'
import { CardRepository } from '../infrastructure/card.repository'
import { scheduleReview, nextDueDate, Grade } from './sm2.algorithm'

@Service()
export class CardService {
  constructor(private cardRepository: CardRepository) {}

  listCards(deckId: number) {
    return this.cardRepository.listByDeck(deckId)
  }

  listDueCards(deckId: number) {
    return this.cardRepository.listDue(deckId)
  }

  createCard(deckId: number, front: string, back: string) {
    return this.cardRepository.create(deckId, front, back)
  }

  async deleteCard(id: number) {
    await this.cardRepository.remove(id)
    return true
  }

  async reviewCard(id: number, grade: Grade) {
    const card = await this.cardRepository.findById(id)
    if (!card) return null

    const next = scheduleReview(
      { ease: card.ease, interval: card.interval, reps: card.reps },
      grade,
    )

    return this.cardRepository.updateScheduling(
      id,
      next.ease,
      next.interval,
      next.reps,
      nextDueDate(next.interval),
    )
  }
}
