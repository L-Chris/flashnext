import { CardPresenter, reviewOptionsOf } from './card-presenter'
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
import { DESIRED_RETENTION } from 'configs/constants'
import { SettingsService, type DeckSettings } from 'app/modules/settings/application/settings.service'

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
    private settingsService: SettingsService,
    private presenter: CardPresenter,
  ) {}

  /** 今天已消耗的新卡数 / 复习数（以复习当时卡片状态为准，同 Anki） */
  async usageToday(deckId: number, now: Date = new Date(), settings?: DeckSettings) {
    const limits = settings || await this.settingsService.get(deckId)
    const w = dueWindow(now, limits)
    const logs = await this.fsrsRepository.listLogsBetween(deckId, new Date(w.cutStartMs), new Date(w.dayEndMs))
    let newCount = 0
    let reviewCount = 0
    for (const log of logs) {
      if (log.state === STATE_NEW) newCount += 1
      else if (log.state === STATE_REVIEW || log.state === STATE_RELEARNING) reviewCount += 1
    }
    return {
      newCount,
      reviewCount,
      newLimit: limits.newPerDay,
      reviewLimit: limits.reviewPerDay,
      newRemaining: Math.max(0, limits.newPerDay - newCount),
      reviewRemaining: Math.max(0, limits.reviewPerDay - reviewCount),
    }
  }

  private static isIntraday(state: number, interval: number) {
    return interval === 0 && (state === STATE_NEW || state === STATE_LEARNING || state === STATE_RELEARNING)
  }

  /**
   * 分桶：日内学习卡 / 复习(含跨天学习) / 新卡。
   * 已到期日内学习 → 复习/跨天学习 → 新卡 → 提前学习窗口内的未到期卡。
   * learn-ahead 仅在其他可学卡之后使用，不能把刚评分的卡立刻提到队首。
   * 复习卡内部按 retrievability 升序（FSRS 模式下 Anki 的默认排序）。
   */
  private async collect(deckId: number, now: Date, settings: DeckSettings) {
    const [candidates, w] = await Promise.all([
      this.cardRepository.listDueCandidates(deckId, now, settings),
      this.optimizerService.getCurrentW(deckId),
    ])
    const { forgetting_curve } = await import('ts-fsrs')

    const intraday: Bucket[] = []
    const upcoming: Bucket[] = []
    const review: Bucket[] = []
    const fresh: Bucket[] = []

    for (const c of candidates) {
      if (c.state === STATE_NEW) {
        fresh.push({ id: c.id, sort: c.learningOrder ?? Number.MAX_SAFE_INTEGER })
        continue
      }
      if (DueService.isIntraday(c.state, c.interval)) {
        const bucket = c.due.getTime() <= now.getTime() ? intraday : upcoming
        bucket.push({ id: c.id, sort: c.due.getTime() })
        continue
      }
      const elapsed = Math.max(0, elapsedDaysBetween(c.lastReview ?? c.createdAt, now, settings))
      const r = c.stability > 0 ? forgetting_curve(w, elapsed, c.stability) : DESIRED_RETENTION
      review.push({ id: c.id, sort: r })
    }

    intraday.sort((a, b) => a.sort - b.sort)
    upcoming.sort((a, b) => a.sort - b.sort)
    review.sort((a, b) => a.sort - b.sort)
    fresh.sort((a, b) => a.sort - b.sort || a.id - b.id)

    return { intraday, upcoming, review, fresh }
  }

  private static applyLimits(
    buckets: { intraday: Bucket[]; upcoming: Bucket[]; review: Bucket[]; fresh: Bucket[] },
    usage: { reviewRemaining: number; newRemaining: number },
  ) {
    const picked = [
      ...buckets.intraday,
      ...buckets.review.slice(0, usage.reviewRemaining),
      ...buckets.fresh.slice(0, usage.newRemaining),
      ...buckets.upcoming,
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
    const settings = await this.settingsService.get(deckId)
    const buckets = await this.collect(deckId, now, settings)
    const usage = await this.usageToday(deckId, now, settings)
    const { picked, hiddenByLimit } = DueService.applyLimits(buckets, usage)
    return {
      dueCount: picked.length,
      usage,
      counts: {
        intraday: buckets.intraday.length + buckets.upcoming.length,
        review: buckets.review.length,
        fresh: buckets.fresh.length,
        hiddenByLimit,
      },
    }
  }

  async queue(deckId: number, now: Date = new Date()) {
    const settings = await this.settingsService.get(deckId)
    const buckets = await this.collect(deckId, now, settings)
    const usage = await this.usageToday(deckId, now, settings)
    const { picked, hiddenByLimit } = DueService.applyLimits(buckets, usage)

    const order = new Map(picked.map((p, i) => [p.id, i] as const))
    const full = picked.length ? await this.cardRepository.listByIds(picked.map(p => p.id)) : []
    full.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

    return {
      cards: await this.presenter.cards(full, settings),
      reviewOptions: reviewOptionsOf(settings),
      usage,
      counts: {
        intraday: buckets.intraday.length + buckets.upcoming.length,
        review: buckets.review.length,
        fresh: buckets.fresh.length,
        queued: picked.length,
        hiddenByLimit,
      },
    }
  }
}
