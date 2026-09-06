import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'
import { scheduleReview, type StoredCardState } from 'app/modules/cards/application/fsrs.scheduler'
import { OptimizerService } from 'app/modules/fsrs/application/optimizer.service'
import { FsrsRepository } from 'app/modules/fsrs/infrastructure/fsrs.repository'
import { TZ_NAME, cutStartOfIndex, dayIndexOf } from 'app/shared/day-boundary'

import type { RevlogRow as LogRow } from '../infrastructure/fsrs.repository'

export interface RebuildJob {
  running: boolean
  startedAt: string | null
  finishedAt: string | null
  dryRun: boolean
  progress: { cards: number; totalCards: number; logs: number; totalLogs: number }
  result: RebuildResult | null
  error: string | null
}

export interface RebuildResult {
  cards: number
  logs: number
  dryRun: boolean
  elapsedMs: number
  w: number[]
  dueTodayBefore: number
  dueTodayAfter: number
  intervalPercentiles: Record<string, number>
  maxDue: string
  forecast: Array<{ day: string; due: number }>
  stateHistogram: Record<string, number>
}

const emptyJob = (): RebuildJob => ({
  running: false,
  startedAt: null,
  finishedAt: null,
  dryRun: false,
  progress: { cards: 0, totalCards: 0, logs: 0, totalLogs: 0 },
  result: null,
  error: null,
})

const CARD_BATCH = 500
const LOG_BATCH = 2000
const FORECAST_DAYS = 30

@Service()
export class RebuildService {
  private job: RebuildJob = emptyJob()

  constructor(private optimizerService: OptimizerService, private fsrsRepository: FsrsRepository) {}

  status() {
    return this.job
  }

  /** 立即返回；重建在后台执行，进度通过 status() 轮询 */
  start(dryRun = false) {
    if (this.job.running) return { started: false, reason: 'already running', job: this.job }
    this.job = { ...emptyJob(), running: true, dryRun, startedAt: new Date().toISOString() }
    void this.run(dryRun).catch(error => {
      this.job.running = false
      this.job.finishedAt = new Date().toISOString()
      this.job.error = error?.message || String(error)
    })
    return { started: true, dryRun, job: this.job }
  }

  private async run(dryRun: boolean) {
    const t0 = Date.now()
    const now = new Date()
    const w = await this.optimizerService.getCurrentW()
    const logs = (await this.fsrsRepository.listAllLogs()) as LogRow[]

    const byCard = new Map<number, LogRow[]>()
    for (const log of logs) {
      const seq = byCard.get(log.cardId)
      if (seq) seq.push(log)
      else byCard.set(log.cardId, [log])
    }

    const cards = await prisma.card.findMany({ select: { id: true, due: true } })
    const cardIds = new Set(cards.map(c => c.id))
    // 丢弃指向已删除卡片的日志
    for (const cardId of [...byCard.keys()]) {
      if (!cardIds.has(cardId)) byCard.delete(cardId)
    }

    this.job.progress.totalCards = byCard.size
    this.job.progress.totalLogs = logs.filter(l => cardIds.has(l.cardId)).length

    const todayIdx = dayIndexOf(now)
    const dueTodayBefore = cards.filter(c => dayIndexOf(c.due) <= todayIdx).length

    const cardUpdates: Array<{ id: number; data: Record<string, unknown> }> = []
    const rewrittenLogs: Array<Omit<LogRow, 'id'>> = []

    let done = 0
    for (const [cardId, seq] of byCard) {
      seq.sort((a, b) => a.reviewAt.getTime() - b.reviewAt.getTime())
      let stored: StoredCardState = {
        id: cardId,
        due: seq[0].reviewAt,
        stability: 0,
        difficulty: 0,
        state: 0,
        reps: 0,
        lapses: 0,
        learningSteps: 0,
        interval: 0,
        lastReview: null,
      }

      for (const log of seq) {
        rewrittenLogs.push({
          cardId,
          rating: log.rating,
          reviewAt: log.reviewAt,
          state: stored.state,
          interval: stored.interval,
          stability: stored.stability,
          difficulty: stored.difficulty,
          durationMs: log.durationMs,
          repsBefore: stored.reps,
          lapsesBefore: stored.lapses,
          learningStepsBefore: stored.learningSteps,
          dueBefore: stored.due,
        })
        const next = await scheduleReview(stored, log.rating as 1 | 2 | 3 | 4, w, log.reviewAt)
        stored = {
          id: cardId,
          due: next.due,
          stability: next.stability,
          difficulty: next.difficulty,
          state: next.state,
          reps: next.reps,
          lapses: next.lapses,
          learningSteps: next.learning_steps,
          interval: next.scheduled_days,
          lastReview: log.reviewAt,
        }
      }

      cardUpdates.push({
        id: cardId,
        data: {
          stability: stored.stability,
          difficulty: stored.difficulty,
          state: stored.state,
          reps: stored.reps,
          lapses: stored.lapses,
          learningSteps: stored.learningSteps,
          interval: stored.interval,
          due: stored.due,
          lastReview: seq[seq.length - 1].reviewAt,
        },
      })

      done += 1
      this.job.progress.cards = done
      this.job.progress.logs = rewrittenLogs.length
    }

    // 无复习历史的卡片：把默认的「创建时刻」due 对齐到日切点
    for (const card of cards) {
      if (byCard.has(card.id)) continue
      cardUpdates.push({ id: card.id, data: { due: new Date(cutStartOfIndex(dayIndexOf(card.due))) } })
    }

    if (!dryRun) {
      for (let i = 0; i < cardUpdates.length; i += CARD_BATCH) {
        const batch = cardUpdates.slice(i, i + CARD_BATCH)
        await prisma.$transaction(batch.map(u => prisma.card.update({ where: { id: u.id }, data: u.data as any })))
      }
      await prisma.reviewLog.deleteMany({})
      for (let i = 0; i < rewrittenLogs.length; i += LOG_BATCH) {
        await prisma.reviewLog.createMany({ data: rewrittenLogs.slice(i, i + LOG_BATCH) as any })
      }
      await this.fsrsRepository.markRevlogMigrated()
    }

    const intervals = cardUpdates.map(u => Number(u.data.interval ?? 0)).sort((a, b) => a - b)
    const pct = (p: number) => intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * p))] ?? 0
    const dayCounts = new Map<number, number>()
    const stateHistogram: Record<string, number> = {}
    let dueTodayAfter = 0
    let maxDue = 0
    for (const u of cardUpdates) {
      const due = u.data.due as Date
      maxDue = Math.max(maxDue, due.getTime())
      const idx = dayIndexOf(due)
      if (idx <= todayIdx) dueTodayAfter += 1
      else if (idx <= todayIdx + FORECAST_DAYS) dayCounts.set(idx, (dayCounts.get(idx) ?? 0) + 1)
      const key = String(u.data.state ?? 0)
      stateHistogram[key] = (stateHistogram[key] ?? 0) + 1
    }

    this.job.result = {
      cards: cardUpdates.length,
      logs: rewrittenLogs.length,
      dryRun,
      elapsedMs: Date.now() - t0,
      w,
      dueTodayBefore,
      dueTodayAfter,
      intervalPercentiles: { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: pct(1) },
      maxDue: new Date(maxDue || Date.now()).toISOString(),
      forecast: [...dayCounts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([idx, dueCount]) => ({ day: dayLabel(idx), due: dueCount })),
      stateHistogram,
    }
    this.job.running = false
    this.job.finishedAt = new Date().toISOString()
  }
}

const dayLabel = (idx: number) =>
  new Date(cutStartOfIndex(idx)).toLocaleDateString('en-CA', { timeZone: TZ_NAME })
