import { Service } from 'typedi'
import { CardRepository } from '../infrastructure/card.repository'
import { scheduleReview } from './fsrs.scheduler'
import { OptimizerService } from 'app/modules/fsrs/application/optimizer.service'
import { FsrsRepository } from 'app/modules/fsrs/infrastructure/fsrs.repository'

@Service()
export class CardService {
  constructor(
    private cardRepository: CardRepository,
    private optimizerService: OptimizerService,
    private fsrsRepository: FsrsRepository,
  ) {}

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

  async reviewCard(id: number, rating: 1 | 2 | 3 | 4) {
    const card = await this.cardRepository.findById(id)
    if (!card) return null

    await this.fsrsRepository.appendLog(id, rating)

    const w = await this.optimizerService.getCurrentW()
    const next = await scheduleReview(
      {
        due: card.due,
        stability: card.stability,
        difficulty: card.difficulty,
        state: card.state,
        reps: card.reps,
        lapses: card.lapses,
        learningSteps: card.learningSteps,
        interval: card.interval,
        lastReview: card.lastReview,
      },
      rating,
      w,
    )

    return this.cardRepository.updateScheduling(id, {
      stability: next.stability,
      difficulty: next.difficulty,
      state: next.state,
      reps: next.reps,
      lapses: next.lapses,
      learningSteps: next.learning_steps,
      interval: next.scheduled_days,
      due: next.due,
      lastReview: new Date(),
    })
  }
}
