import { Service } from 'typedi'
import { CardRepository } from '../infrastructure/card.repository'
import { DueService } from './due.service'
import { scheduleReview } from './fsrs.scheduler'
import { OptimizerService } from 'app/modules/fsrs/application/optimizer.service'
import { FsrsRepository } from 'app/modules/fsrs/infrastructure/fsrs.repository'

@Service()
export class CardService {
  constructor(
    private cardRepository: CardRepository,
    private dueService: DueService,
    private optimizerService: OptimizerService,
    private fsrsRepository: FsrsRepository,
  ) {}

  listCards(deckId: number) {
    return this.cardRepository.listByDeck(deckId)
  }

  /** 复习队列（含日限额与 Anki 式排序），供 /cards/due 使用 */
  queue(deckId: number) {
    return this.dueService.queue(deckId)
  }

  createCard(deckId: number, front: string, back: string) {
    return this.cardRepository.create(deckId, front, back)
  }

  async deleteCard(id: number) {
    await this.cardRepository.remove(id)
    return true
  }

  async reviewCard(id: number, rating: 1 | 2 | 3 | 4, durationMs = 0) {
    const card = await this.cardRepository.findById(id)
    if (!card) return null

    const now = new Date()
    // 复习当时的记忆状态 + 复习前快照一并落库：
    // state 既是 new/review 日限额的依据，也是 fsrs-rs 训练所需的 review_state 列；
    // 快照字段用于精确撤销。
    await this.fsrsRepository.createLog(rating, durationMs, card)

    const w = await this.optimizerService.getCurrentW()
    const next = await scheduleReview(
      {
        id: card.id,
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
      now,
    )

    const updated = await this.cardRepository.updateScheduling(id, {
      stability: next.stability,
      difficulty: next.difficulty,
      state: next.state,
      reps: next.reps,
      lapses: next.lapses,
      learningSteps: next.learning_steps,
      interval: next.scheduled_days,
      due: next.due,
      lastReview: now,
    })
    return updated
  }

  /** 撤销某张卡最近一次评分（Anki 的 undo）：还原快照并删掉该条复习日志 */
  async undoCard(id: number) {
    const card = await this.cardRepository.findById(id)
    if (!card) return null
    const log = await this.fsrsRepository.lastLogOf(id)
    if (!log) return null

    const restored = await this.cardRepository.updateScheduling(id, {
      stability: log.stability,
      difficulty: log.difficulty,
      state: log.state,
      reps: log.repsBefore,
      lapses: log.lapsesBefore,
      learningSteps: log.learningStepsBefore,
      interval: log.interval,
      due: log.dueBefore ?? card.due,
      lastReview: card.lastReview,
    })
    await this.fsrsRepository.deleteLog(log.id)
    return restored
  }
}
