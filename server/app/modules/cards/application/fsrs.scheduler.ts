import type { Card as FSRSCard, IFSRS } from 'ts-fsrs' with { 'resolution-mode': 'import' }
import { DAY_MS, cutStartOf, nextCutStartOf } from 'app/shared/day-boundary'
import { DESIRED_RETENTION, MAXIMUM_INTERVAL } from 'configs/constants'

export interface StoredCardState {
  id: number
  due: Date
  stability: number
  difficulty: number
  state: number
  reps: number
  lapses: number
  learningSteps: number
  interval: number
  lastReview: Date | null
}

// Anki 对复习卡强制加 fuzz；ts-fsrs 默认关闭，这里显式打开。
const ENABLE_FUZZ = true

let cache: { key: string; scheduler: IFSRS } | null = null

export const warmupFSRS = async (): Promise<void> => {
  await import('ts-fsrs')
}

const getScheduler = async (w: number[]): Promise<IFSRS> => {
  const key = `${ENABLE_FUZZ}:${DESIRED_RETENTION}:${MAXIMUM_INTERVAL}:${w.join(',')}`
  if (cache && cache.key === key) return cache.scheduler
  const { fsrs, generatorParameters, GenSeedStrategyWithCardId, StrategyMode } = await import('ts-fsrs')
  const scheduler = fsrs(
    generatorParameters({
      w,
      enable_fuzz: ENABLE_FUZZ,
      request_retention: DESIRED_RETENTION,
      maximum_interval: MAXIMUM_INTERVAL,
    }),
  ).useStrategy(StrategyMode.SEED, GenSeedStrategyWithCardId('id'))
  cache = { key, scheduler }
  return scheduler
}

// review_time / last_review 都对齐到日切点，使 ts-fsrs 内部的 dateDiffInDays
// 得到与 Anki 相同的 elapsed_days，且 scheduled_days>=1 时产出的 due
// 天然等于 cutStart + N 天（而不是「复习时刻 + N*24h」）。
export const toFSRSCard = (stored: StoredCardState, cutMs: number): FSRSCard => ({
  due: new Date(cutMs),
  stability: stored.stability,
  difficulty: stored.difficulty,
  elapsed_days: 0,
  scheduled_days: stored.interval,
  learning_steps: stored.learningSteps,
  reps: stored.reps,
  lapses: stored.lapses,
  state: stored.state as FSRSCard['state'],
  last_review: stored.lastReview ? new Date(cutStartOf(stored.lastReview)) : undefined,
} as FSRSCard)

// Anki 的 Day Boundaries 规则：日内 step 以真实复习时刻为基准；
// 一旦 delay 跨过下一个日切点，就换算成整天。
const applyDayBoundary = (card: FSRSCard, nowMs: number, cutMs: number): FSRSCard => {
  if (card.scheduled_days >= 1) {
    return { ...card, due: new Date(cutMs + card.scheduled_days * DAY_MS) }
  }
  const minutes = Math.round((card.due.getTime() - cutMs) / 60000)
  const intraday = nowMs + minutes * 60000
  if (intraday >= nextCutStartOf(nowMs)) {
    return { ...card, due: new Date(cutMs + DAY_MS), scheduled_days: 1 }
  }
  return { ...card, due: new Date(intraday) }
}

export const scheduleReview = async (
  stored: StoredCardState,
  rating: 1 | 2 | 3 | 4,
  w: number[],
  now: Date = new Date(),
): Promise<FSRSCard> => {
  const nowMs = now.getTime()
  const cutMs = cutStartOf(nowMs)
  const scheduler = await getScheduler(w)
  const card = { ...toFSRSCard(stored, cutMs), id: stored.id } as any
  // next() 只算被点击的那一档；repeat() 会构造全部四档
  const { card: next } = scheduler.next(card, new Date(cutMs), rating)
  return applyDayBoundary(next, nowMs, cutMs)
}

export const clearSchedulerCache = (): void => {
  cache = null
}
