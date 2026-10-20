import { Service } from 'typedi'
import { HttpError } from 'routing-controllers'
import { createHash } from 'node:crypto'
import { prisma } from 'app/shared/prisma'
import { scheduleReview, type StoredCardState } from 'app/modules/cards/application/fsrs.scheduler'
import { OptimizerService } from './optimizer.service'
import { FsrsRepository, listDeckLogs, type RevlogRow } from '../infrastructure/fsrs.repository'
import { SettingsService } from 'app/modules/settings/application/settings.service'
import { DeckWorkLock } from './deck-work-lock'
import { cutStartOfIndex, dayIndexOf } from 'app/shared/day-boundary'

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


const emptyJob = (): RebuildJob => ({ running: false, startedAt: null, finishedAt: null, dryRun: false,
  progress: { cards: 0, totalCards: 0, logs: 0, totalLogs: 0 }, result: null, error: null })
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
type CardUpdate = { id: number; stability?: number; difficulty?: number; state?: number; reps?: number; lapses?: number; learningSteps?: number; interval?: number; due: number; lastReview?: number }
type LogUpdate = { id: number; state: number; interval: number; stability: number; difficulty: number; repsBefore: number; lapsesBefore: number; learningStepsBefore: number; dueBefore: number }
interface Plan { createdAt: number; hash: string; settingsVersion: number; paramsVersion: number; cards: CardUpdate[]; logs: LogUpdate[]; result: RebuildResult }

@Service()
export class RebuildService {
  private jobs = new Map<number, RebuildJob>()
  private plans = new Map<number, Plan>()
  constructor(private optimizerService: OptimizerService, private fsrsRepository: FsrsRepository,
    private settingsService: SettingsService, private workLock: DeckWorkLock) {}

  status(deckId: number) { return this.jobs.get(deckId) || emptyJob() }

  async start(deckId: number, dryRun = false) {
    await this.settingsService.get(deckId)
    if (this.status(deckId).running) return { started: false, reason: 'already running', job: this.status(deckId) }
    if (!dryRun && !this.plans.has(deckId)) throw new HttpError(409, '请先预览本牌组的重建结果')
    this.workLock.acquire(deckId, 'rebuild')
    const job = { ...emptyJob(), running: true, dryRun, startedAt: new Date().toISOString() }
    this.jobs.set(deckId, job)
    const run = dryRun ? this.prepare(deckId, job) : this.apply(deckId, job)
    void run.catch(error => Object.assign(job, { running: false, finishedAt: new Date().toISOString(), error: error?.message || String(error) }))
      .finally(() => this.workLock.release(deckId))
    return { started: true, dryRun, job }
  }

  private async prepare(deckId: number, job: RebuildJob) {
    this.plans.delete(deckId)
    const t0 = Date.now(), now = new Date()
    const settings = await this.settingsService.get(deckId)
    const param = await this.fsrsRepository.getParamRow(deckId)
    const w = await this.optimizerService.getCurrentW(deckId)
    const cards = await prisma.card.findMany({ where: { deckId }, orderBy: { id: 'asc' } })
    const logs = await this.fsrsRepository.listAllLogs(deckId)
    const hash = fingerprint({ cards, logs })
    const byCard = new Map<number, RevlogRow[]>()
    for (const log of logs) { const list = byCard.get(log.cardId) || []; list.push(log); byCard.set(log.cardId, list) }
    job.progress.totalCards = cards.length; job.progress.totalLogs = logs.length
    const updates: CardUpdate[] = [], rewritten: LogUpdate[] = []
    for (const card of cards) {
      const seq = byCard.get(card.id) || []
      let stored: StoredCardState = { id: card.id, due: seq[0]?.reviewAt || card.due, stability: 0, difficulty: 0,
        state: 0, reps: 0, lapses: 0, learningSteps: 0, interval: 0, lastReview: null }
      for (const log of seq) {
        rewritten.push({ id: log.id, state: stored.state, interval: stored.interval, stability: stored.stability,
          difficulty: stored.difficulty, repsBefore: stored.reps, lapsesBefore: stored.lapses,
          learningStepsBefore: stored.learningSteps, dueBefore: stored.due.getTime() })
        const next = await scheduleReview(stored, log.rating as 1 | 2 | 3 | 4, w, log.reviewAt, settings)
        stored = { id: card.id, due: next.due, stability: next.stability, difficulty: next.difficulty, state: next.state,
          reps: next.reps, lapses: next.lapses, learningSteps: next.learning_steps, interval: next.scheduled_days, lastReview: log.reviewAt }
        job.progress.logs++
      }
      updates.push(seq.length ? { id: card.id, stability: stored.stability, difficulty: stored.difficulty,
        state: stored.state, reps: stored.reps, lapses: stored.lapses, learningSteps: stored.learningSteps,
        interval: stored.interval, due: stored.due.getTime(), lastReview: seq[seq.length - 1].reviewAt.getTime() }
        : { id: card.id, due: cutStartOfIndex(dayIndexOf(card.due, settings), settings) })
      job.progress.cards++
    }
    const today = dayIndexOf(now, settings)
    const intervals = updates.map(c => c.interval || 0).sort((a,b) => a-b)
    const pct = (p: number) => intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * p))] || 0
    const histogram: Record<string, number> = {}, counts = new Map<number, number>()
    const oldStates = new Map(cards.map(c => [c.id, c.state]))
    for (const c of updates) {
      const state = String(c.state ?? oldStates.get(c.id) ?? 0)
      histogram[state] = (histogram[state] || 0) + 1
      const day = dayIndexOf(c.due, settings)
      if (day > today && day <= today + 30) counts.set(day, (counts.get(day) || 0) + 1)
    }
    const result: RebuildResult = { cards: cards.length, logs: logs.length, dryRun: true, elapsedMs: Date.now()-t0, w,
      dueTodayBefore: cards.filter(c => dayIndexOf(c.due, settings) <= today).length,
      dueTodayAfter: updates.filter(c => dayIndexOf(c.due, settings) <= today).length,
      intervalPercentiles: { p50: pct(.5), p90: pct(.9), p99: pct(.99), max: pct(1) },
      maxDue: new Date(updates.reduce((max, c) => Math.max(max, c.due), Date.now())).toISOString(), stateHistogram: histogram,
      forecast: [...counts].sort((a,b) => a[0]-b[0]).map(([day,due]) => ({ day: new Date(cutStartOfIndex(day,settings)).toLocaleDateString('en-CA',{timeZone:settings.timezone}), due })) }
    this.plans.set(deckId, { createdAt: Date.now(), hash, settingsVersion: settings.version, paramsVersion: param.version, cards: updates, logs: rewritten, result })
    Object.assign(job, { running: false, finishedAt: new Date().toISOString(), result })
  }

  private async apply(deckId: number, job: RebuildJob) {
    const plan = this.plans.get(deckId)!
    if (Date.now() - plan.createdAt > 15 * 60 * 1000) throw new HttpError(409, '预览已过期，请重新预览')
    await prisma.$transaction(async tx => {
      const settings = await tx.deckSetting.findUnique({ where: { deckId } })
      const param = await tx.deckFsrsParam.findUnique({ where: { deckId } })
      if (!settings || !param || settings.version !== plan.settingsVersion || param.version !== plan.paramsVersion) throw new HttpError(409, '牌组设置或参数已改变，请重新预览')
      const cards = await tx.card.findMany({ where: { deckId }, orderBy: { id: 'asc' } })
      const logs = await listDeckLogs(tx, deckId)
      if (fingerprint({ cards, logs }) !== plan.hash) throw new HttpError(409, '牌组卡片或复习记录已改变，请重新预览')
      for (let i=0;i<plan.cards.length;i+=500) {
        const batch=JSON.stringify(plan.cards.slice(i,i+500))
        const n=await tx.$executeRaw`UPDATE cards SET due=json_extract(j.value,'$.due'),
          stability=COALESCE(json_extract(j.value,'$.stability'),stability), difficulty=COALESCE(json_extract(j.value,'$.difficulty'),difficulty),
          state=COALESCE(json_extract(j.value,'$.state'),state), reps=COALESCE(json_extract(j.value,'$.reps'),reps), lapses=COALESCE(json_extract(j.value,'$.lapses'),lapses),
          learning_steps=COALESCE(json_extract(j.value,'$.learningSteps'),learning_steps), interval=COALESCE(json_extract(j.value,'$.interval'),interval),
          last_review=COALESCE(json_extract(j.value,'$.lastReview'),last_review)
          FROM json_each(${batch}) j WHERE cards.id=json_extract(j.value,'$.id') AND cards.deck_id=${deckId}`
        if(n!==Math.min(500,plan.cards.length-i)) throw new Error('牌组卡片范围已改变')
      }
      for(let i=0;i<plan.logs.length;i+=1000) {
        const batch=JSON.stringify(plan.logs.slice(i,i+1000))
        const n=await tx.$executeRaw`UPDATE review_logs SET state=json_extract(j.value,'$.state'),interval=json_extract(j.value,'$.interval'),
          stability=json_extract(j.value,'$.stability'),difficulty=json_extract(j.value,'$.difficulty'),reps_before=json_extract(j.value,'$.repsBefore'),
          lapses_before=json_extract(j.value,'$.lapsesBefore'),learning_steps_before=json_extract(j.value,'$.learningStepsBefore'),due_before=json_extract(j.value,'$.dueBefore')
          FROM json_each(${batch}) j WHERE review_logs.id=json_extract(j.value,'$.id') AND review_logs.card_id IN (SELECT id FROM cards WHERE deck_id=${deckId})`
        if(n!==Math.min(1000,plan.logs.length-i)) throw new Error('牌组日志范围已改变')
      }
      await tx.deckFsrsParam.update({ where: { deckId }, data: { revlogMigratedAt: new Date(), version: { increment: 1 } } })
    }, { timeout: 60000, maxWait: 10000 })
    this.plans.delete(deckId)
    Object.assign(job, { running: false, finishedAt: new Date().toISOString(), result: { ...plan.result, dryRun: false } })
  }
}
