import { Service } from 'typedi'
import { CardRepository } from '../infrastructure/card.repository'
import {
  STATE_LEARNING,
  STATE_NEW,
  STATE_RELEARNING,
  STATE_REVIEW,
  dueWindow,
} from '../infrastructure/due-filter'
import { FsrsRepository } from 'app/modules/fsrs/infrastructure/fsrs.repository'
import { OptimizerService } from 'app/modules/fsrs/application/optimizer.service'
import { elapsedDaysBetween } from 'app/shared/day-boundary'
import { DESIRED_RETENTION, NEW_CARDS_PER_DAY, REVIEWS_PER_DAY } from 'configs/constants'

interface Bucket {
  id: number
  sort: number
}

@Service()
export class DueService {
  constructor(
    private cardRepository: CardRepository,
    private fsrsRepository: FsrsRepository,
    private optimizerService: OptimizerService,
  ) {}

  /** 今天已消耗的新卡数 / 复习数（以复习当时卡片状态为准，同 Anki） */
  async usageToday(deckId: number, now: Date = new Date()) {
    const w = dueWindow(now)
    const [ids, logs] = await Promise.all([
      this.cardRepository.listIds(deckId),
      this.fsrsRepository.listLogsBetween(new Date(w.cutStartMs), new Date(w.dayEndMs)),
    ])
    const idSet = new Set(ids.map(row => row.id))
    let newCount = 0
    let reviewCount = 0
    for (const log of logs) {
      if (!idSet.has(log.cardId)) continue
      if (log.state === STATE_NEW) newCount += 1
      else if (log.state === STATE_REVIEW || log.state === STATE_RELEARNING) reviewCount += 1
    }
    return {
      newCount,
      reviewCount,
      newLimit: NEW_CARDS_PER_DAY,
      reviewLimit: REVIEWS_PER_DAY,
      newRemaining: Math.max(0, NEW_CARDS_PER_DAY - newCount),
      reviewRemaining: Math.max(0, REVIEWS_PER_DAY - reviewCount),
    }
  }

  private static isIntraday(state: number, interval: number) {
    return interval === 0 && (state === STATE_NEW || state === STATE_LEARNING || state === STATE_RELEARNING)
  }

  /**
   * 分桶：日内学习卡 / 复习(含跨天学习) / 新卡。
   * Anki 的 gather 顺序 = intraday learning → interday learning → review → new，
   * 复习卡内部按 retrievability 升序（FSRS 模式下 Anki 的默认排序）。
   */
  private async collect(deckId: number, now: Date) {
    const [candidates, w] = await Promise.all([
      this.cardRepository.listDueCandidates(deckId, now),
      this.optimizerService.getCurrentW(),
    ])
    const { forgetting_curve } = await import('ts-fsrs')

    const intraday: Bucket[] = []
    const review: Bucket[] = []
    const fresh: Bucket[] = []

    for (const c of candidates) {
      if (c.state === STATE_NEW) {
        fresh.push({ id: c.id, sort: c.id })
        continue
      }
      if (DueService.isIntraday(c.state, c.interval)) {
        intraday.push({ id: c.id, sort: c.due.getTime() })
        continue
      }
      const elapsed = Math.max(0, elapsedDaysBetween(c.lastReview ?? c.createdAt, now))
      const r = c.stability > 0 ? forgetting_curve(w, elapsed, c.stability) : DESIRED_RETENTION
      review.push({ id: c.id, sort: r })
    }

    intraday.sort((a, b) => a.sort - b.sort)
    review.sort((a, b) => a.sort - b.sort)
    fresh.sort((a, b) => a.sort - b.sort)

    return { intraday, review, fresh }
  }

  private static applyLimits(
    buckets: { intraday: Bucket[]; review: Bucket[]; fresh: Bucket[] },
    usage: { reviewRemaining: number; newRemaining: number },
  ) {
    const picked = [
      ...buckets.intraday,
      ...buckets.review.slice(0, usage.reviewRemaining),
      ...buckets.fresh.slice(0, usage.newRemaining),
    ]
    return {
      picked,
      hiddenByLimit:
        Math.max(0, buckets.review.length - usage.reviewRemaining) +
        Math.max(0, buckets.fresh.length - usage.newRemaining),
    }
  }

  /** 牌组列表用：今天还能复习多少张（已扣除日限额） */
  async summary(deckId: number, now: Date = new Date()) {
    const buckets = await this.collect(deckId, now)
    const usage = await this.usageToday(deckId, now)
    const { picked, hiddenByLimit } = DueService.applyLimits(buckets, usage)
    return {
      dueCount: picked.length,
      usage,
      counts: {
        intraday: buckets.intraday.length,
        review: buckets.review.length,
        fresh: buckets.fresh.length,
        hiddenByLimit,
      },
    }
  }

  async queue(deckId: number, now: Date = new Date()) {
    const buckets = await this.collect(deckId, now)
    const usage = await this.usageToday(deckId, now)
    const { picked, hiddenByLimit } = DueService.applyLimits(buckets, usage)

    const order = new Map(picked.map((p, i) => [p.id, i] as const))
    const full = picked.length ? await this.cardRepository.listByIds(picked.map(p => p.id)) : []
    full.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

    return {
      cards: full,
      usage,
      counts: {
        intraday: buckets.intraday.length,
        review: buckets.review.length,
        fresh: buckets.fresh.length,
        queued: picked.length,
        hiddenByLimit,
      },
    }
  }
}
