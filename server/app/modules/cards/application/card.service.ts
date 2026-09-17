import { Service } from 'typedi'
import { CardRepository } from '../infrastructure/card.repository'
import { DueService } from './due.service'
import { scheduleReview } from './fsrs.scheduler'
import { OptimizerService } from 'app/modules/fsrs/application/optimizer.service'
import { FsrsRepository } from 'app/modules/fsrs/infrastructure/fsrs.repository'
import { dayIndexOf, elapsedDaysBetween } from 'app/shared/day-boundary'

export const CARD_SORT_KEYS = [
  'rank',
  'stability',
  'difficulty',
  'retrievability',
  'lapseRate',
  'overdue',
  'due',
  'reps',
  'lapses',
  'lastReview',
  'createdAt',
  'state',
  'interval',
  'headword',
] as const

export type CardSortKey = (typeof CARD_SORT_KEYS)[number]

export interface CardPageQuery {
  sort: CardSortKey
  dir: 'asc' | 'desc'
  page: number
  pageSize: number
  q: string
}

const PAGE_SIZES = [20, 50, 100, 200]

export const normalizeCardPageQuery = (raw: {
  sort?: string
  dir?: string
  page?: string
  pageSize?: string
  q?: string
}): CardPageQuery => {
  const sort = (CARD_SORT_KEYS as readonly string[]).includes(raw.sort || '')
    ? (raw.sort as CardSortKey)
    : 'difficulty'
  const dir = raw.dir === 'asc' ? 'asc' : 'desc'
  const pageSize = PAGE_SIZES.includes(Number(raw.pageSize)) ? Number(raw.pageSize) : 50
  const page = Math.max(1, Number(raw.page) || 1)
  return { sort, dir, page, pageSize, q: (raw.q || '').trim() }
}

export interface CardPageRow {
  id: number
  front: string
  state: number
  stability: number
  difficulty: number
  reps: number
  lapses: number
  interval: number
  due: Date
  lastReview: Date | null
  createdAt: Date
  rank: number | null
  retrievability: number
  overdueDays: number
  lapseRate: number
}

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

  /**
   * 牌组详情页表格数据：轻量行 + 派生指标（R / 逾期 / 失忆率）→ 内存排序 → 切片 → 当页 hydrate。
   * R 用当前 w 的遗忘曲线；新卡/学习卡没有「保持率」语义，记为 1。
   */
  async listCardsPaged(deckId: number, query: CardPageQuery) {
    const { sort, dir, page, pageSize, q } = query
    const needle = q.toLowerCase()
    const [rows, w] = await Promise.all([
      this.cardRepository.listLightByDeck(deckId),
      this.optimizerService.getCurrentW(),
    ])
    const { forgetting_curve } = await import('ts-fsrs')
    const now = new Date()
    const todayIdx = dayIndexOf(now)

    const matched = needle
      ? rows.filter(
          r =>
            r.front.toLowerCase().includes(needle) ||
            (r.word?.translation || '').toLowerCase().includes(needle),
        )
      : rows

    const enriched: CardPageRow[] = matched.map(r => {
      const elapsed = r.lastReview ? Math.max(0, elapsedDaysBetween(r.lastReview, now)) : 0
      const retrievability =
        r.stability > 0 && r.lastReview ? forgetting_curve(w, elapsed, r.stability) : 1
      return {
        id: r.id,
        front: r.front,
        state: r.state,
        stability: r.stability,
        difficulty: r.difficulty,
        reps: r.reps,
        lapses: r.lapses,
        interval: r.interval,
        due: r.due,
        lastReview: r.lastReview,
        createdAt: r.createdAt,
        rank: r.word?.rank ?? null,
        retrievability,
        overdueDays: todayIdx - dayIndexOf(r.due),
        lapseRate: r.reps > 0 ? r.lapses / r.reps : 0,
      }
    })

    const valueOf = (row: CardPageRow): number | string => {
      switch (sort) {
        case 'rank': return row.rank ?? Number.MAX_SAFE_INTEGER
        case 'stability': return row.stability
        case 'difficulty': return row.difficulty
        case 'retrievability': return row.retrievability
        case 'lapseRate': return row.lapseRate
        case 'overdue': return row.overdueDays
        case 'due': return row.due.getTime()
        case 'reps': return row.reps
        case 'lapses': return row.lapses
        case 'lastReview': return row.lastReview?.getTime() ?? 0
        case 'createdAt': return row.createdAt.getTime()
        case 'state': return row.state
        case 'interval': return row.interval
        default: return row.front.toLowerCase()
      }
    }
    const sign = dir === 'asc' ? 1 : -1
    enriched.sort((a, b) => {
      const va = valueOf(a)
      const vb = valueOf(b)
      if (va < vb) return -sign
      if (va > vb) return sign
      return a.id - b.id
    })

    const total = enriched.length
    const pages = Math.max(1, Math.ceil(total / pageSize))
    const safePage = Math.min(Math.max(1, page), pages)
    const slice = enriched.slice((safePage - 1) * pageSize, safePage * pageSize)

    const order = new Map(slice.map((r, i) => [r.id, i] as const))
    const full = slice.length ? await this.cardRepository.listByIds(slice.map(r => r.id)) : []
    const byId = new Map(full.map(c => [c.id, c] as const))
    const cards = slice
      .map(row => {
        const card = byId.get(row.id)
        return card ? { ...card, ...row } : null
      })
      .filter(Boolean)
      .sort((a, b) => (order.get(a!.id) ?? 0) - (order.get(b!.id) ?? 0))

    void order
    return { cards, total, page: safePage, pageSize, pages, sort, dir, q }
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
