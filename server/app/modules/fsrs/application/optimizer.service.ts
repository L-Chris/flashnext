import { HttpError } from 'routing-controllers'
import { SettingsService } from 'app/modules/settings/application/settings.service'
import { DeckWorkLock } from './deck-work-lock'
import { Service } from 'typedi'
import { FsrsRepository } from '../infrastructure/fsrs.repository'
import { fsrsOffsetProvider } from 'app/shared/day-boundary'
import { clearSchedulerCache } from 'app/modules/cards/application/fsrs.scheduler'
import { MIN_TRAINING_REVIEWS, OPTIMIZE_TIMEOUT_MS, RELEARNING_STEPS } from 'configs/constants'

import type * as BindingNS from '@open-spaced-repetition/binding' with { 'resolution-mode': 'import' }
import type * as FsrsNS from 'ts-fsrs' with { 'resolution-mode': 'import' }

type BindingModule = typeof BindingNS
type FsrsModule = typeof FsrsNS

export interface OptimizeJob {
  running: boolean
  startedAt: string | null
  finishedAt: string | null
  force: boolean
  result: OptimizeOutcome | null
  error: string | null
}

export interface OptimizeOutcome {
  saved: boolean
  source?: string
  forced: boolean
  w: number[]
  audit: Audit
  rows: number
  elapsedMs: number
}

interface Audit {
  accepted: boolean
  reasons: string[]
  items: number
  metrics: Record<string, { logLoss: number; rmseBins: number }>
  newCardStability: Record<string, number>
  pinned: string[]
}

let bindingPromise: Promise<BindingModule> | null = null
let fsrsPromise: Promise<FsrsModule> | null = null
let defaultWCache: number[] | null = null

const loadBinding = (): Promise<BindingModule> => {
  if (!bindingPromise) bindingPromise = import('@open-spaced-repetition/binding')
  return bindingPromise
}

const loadFSRS = (): Promise<FsrsModule> => {
  if (!fsrsPromise) fsrsPromise = import('ts-fsrs')
  return fsrsPromise
}

@Service()
export class OptimizerService {
  private jobs = new Map<number, OptimizeJob>()
  constructor(private fsrsRepository: FsrsRepository, private settingsService: SettingsService, private workLock: DeckWorkLock) {}

  status(deckId: number): OptimizeJob {
    return this.jobs.get(deckId) || { running: false, startedAt: null, finishedAt: null, force: false, result: null, error: null }
  }

  async start(deckId: number, options: { force?: boolean; timeoutMs?: number } = {}) {
    await this.settingsService.get(deckId)
    if (this.status(deckId).running) return { started: false, reason: 'already running', job: this.status(deckId) }
    this.workLock.acquire(deckId, 'train')
    const job: OptimizeJob = { running: true, startedAt: new Date().toISOString(), finishedAt: null, force: Boolean(options.force), result: null, error: null }
    this.jobs.set(deckId, job)
    void this.run(deckId, job, options).catch(error => {
      Object.assign(job, { running: false, finishedAt: new Date().toISOString(), error: error?.message || String(error) })
    }).finally(() => this.workLock.release(deckId))
    return { started: true, job }
  }

  private async defaultW(): Promise<number[]> {
    if (!defaultWCache) defaultWCache = [...(await loadFSRS()).default_w]
    return defaultWCache
  }

  async getCurrentW(deckId: number): Promise<number[]> {
    const row = await this.fsrsRepository.getParamRow(deckId)
    if (row) {
      const w = JSON.parse(row.w) as number[]
      if (w.length) return w
    }
    return this.defaultW()
  }

  async getStatus(deckId: number) {
    const row = await this.fsrsRepository.getParamRow(deckId)
    const reviewCount = await this.fsrsRepository.countLogs(deckId)
    const settings = await this.settingsService.get(deckId)
    return {
      deckId,
      w: row ? (JSON.parse(row.w) as number[]) : await this.defaultW(),
      source: row?.source ?? 'default',
      updatedAt: row?.updatedAt ?? null,
      revlogMigratedAt: row?.revlogMigratedAt ?? null,
      reviewCount,
      minReviews: MIN_TRAINING_REVIEWS,
      timezone: settings.timezone,
      rolloverHour: settings.rolloverHour,
    }
  }

  private async buildTrainSet(deckId: number, cardIds?: Set<number>) {
    const binding = await loadBinding()
    const { csv, rows } = await this.fsrsRepository.buildRevlogCsv(deckId, cardIds)
    const settings = await this.settingsService.get(deckId)
    const items = binding.convertCsvToFsrsItems(
      Buffer.from(csv),
      settings.rolloverHour,
      settings.timezone,
      fsrsOffsetProvider,
    )
    return { items, rows }
  }

  private measure(binding: BindingModule, items: any[], w: number[]) {
    const b = new binding.FSRSBinding(w)
    const m = b.evaluate(items)
    const s = b.nextStates(null, 0.9, 0)
    return {
      metrics: { logLoss: m.logLoss, rmseBins: m.rmseBins },
      stability: {
        again: s.again.memory.stability,
        hard: s.hard.memory.stability,
        good: s.good.memory.stability,
        easy: s.easy.memory.stability,
      },
    }
  }

  private async pinnedParams(w: number[]): Promise<string[]> {
    const mod = await loadFSRS()
    const clamps = mod.CLAMP_PARAMETERS(2, true).slice(0, w.length) as number[][]
    const out: string[] = []
    w.forEach((v, i) => {
      const c = clamps[i]
      if (!c) return
      if (v <= c[0] * 1.0000001) out.push(`w[${i}]=${+v.toFixed(4)}@min`)
      else if (v >= c[1] * 0.9999999) out.push(`w[${i}]=${+v.toFixed(4)}@max`)
    })
    return out
  }

  /**
   * 用 fsrs-rs 官方优化器训练参数。
   * 准入只有一条护栏：logLoss / rmseBins 不得比 FSRS-6 默认参数差（官方 evaluate 指标）。
   * 其余完全跟随官方行为：clip 后照用、训练结果照存。
   */
  private async run(deckId: number, job: OptimizeJob, options: { force?: boolean; timeoutMs?: number } = {}): Promise<OptimizeOutcome> {
    const reviewCount = await this.fsrsRepository.countLogs(deckId)
    if (reviewCount < MIN_TRAINING_REVIEWS) {
      throw new Error(`review logs insufficient: ${reviewCount} < ${MIN_TRAINING_REVIEWS}`)
    }

    const row = await this.fsrsRepository.getParamRow(deckId)
    const settings = await this.settingsService.get(deckId)
    const expected = { settings: settings.version, params: row.version }
    if (!row?.revlogMigratedAt) {
      throw new Error(
        'revlog 尚未回填 review_state，先用 本牌组的“预览重建” 重建记忆状态，再训练参数',
      )
    }

    const binding = await loadBinding()
    const { items, rows } = await this.buildTrainSet(deckId)
    if (!items.length) {
      throw new Error(`no trainable fsrs items (revlog rows=${rows}); run 本牌组的“预览重建” first`)
    }

    const started = Date.now()
    const w = await binding.computeParameters(items, {
      enableShortTerm: true,
      numRelearningSteps: RELEARNING_STEPS.length,
      timeout: options.timeoutMs ?? OPTIMIZE_TIMEOUT_MS,
    })
    const elapsedMs = Date.now() - started

    const audit = await this.audit(binding, w, items)
    audit.items = items.length

    // 护栏未通过时不落库，把诊断返回给调用方；force 可强制写入
    if (!audit.accepted && !options.force) {
      const outcome: OptimizeOutcome = { saved: false, w, audit, rows, elapsedMs, forced: false }
      Object.assign(job, { running: false, finishedAt: new Date().toISOString(), result: outcome })
      return outcome
    }

    const source = audit.accepted ? 'official-fsrs-rs' : 'official-forced'
    await this.fsrsRepository.saveParams(deckId, w, source, expected)
    clearSchedulerCache()

    const outcome: OptimizeOutcome = {
      saved: true,
      source,
      w,
      audit,
      rows,
      elapsedMs,
      forced: !audit.accepted,
    }
    Object.assign(job, { running: false, finishedAt: new Date().toISOString(), result: outcome })
    return outcome
  }

  /**
   * 手工写入 w（可省略以重置为 FSRS-6 官方默认值）。
   * 用于两种情况：训练数据来自别的调度器导致官方优化结果退化时回退默认值；
   * 或直接粘贴 Anki「Optimize」得到的参数。
   */
  async setParams(deckId: number, w?: number[], withAudit = false) {
    await this.settingsService.get(deckId)
    const manual = Array.isArray(w) && w.length > 0
    const target = manual ? (w as number[]).map(Number) : await this.defaultW()
    if (target.length !== (await this.defaultW()).length || target.some(v => !Number.isFinite(v))) {
      throw new Error('invalid weights')
    }
    await this.fsrsRepository.saveParams(deckId, target, manual ? 'manual' : 'default')
    clearSchedulerCache()
    const audit = withAudit ? await this.auditParameters(deckId, target).catch(e => ({ error: String(e?.message || e) })) : null
    return { ...(await this.getStatus(deckId)), audit }
  }

  /** 只评估、不落库，用于预览/诊断 */
  async auditParameters(deckId: number, w: number[], cardIds?: Set<number>): Promise<Audit> {
    const binding = await loadBinding()
    const { items } = await this.buildTrainSet(deckId, cardIds)
    const audit = await this.audit(binding, w, items)
    audit.items = items.length
    return audit
  }

  private async audit(binding: BindingModule, w: number[], items: any[]): Promise<Audit> {
    const defaults = await this.defaultW()
    const reasons: string[] = []

    if (w.length !== defaults.length) {
      reasons.push(`parameter length ${w.length} != ${defaults.length}`)
    }

    let candidate: any = null
    let baseline: any = null
    try {
      candidate = this.measure(binding, items, w)
      baseline = this.measure(binding, items, defaults)
    } catch (error: any) {
      reasons.push(`evaluate failed: ${error?.message || error}`)
    }

    if (candidate && baseline) {
      if (candidate.metrics.logLoss > baseline.metrics.logLoss + 1e-6) {
        reasons.push(
          `logLoss ${candidate.metrics.logLoss.toFixed(4)} worse than default ${baseline.metrics.logLoss.toFixed(4)}`,
        )
      }
      if (candidate.metrics.rmseBins > baseline.metrics.rmseBins + 1e-6) {
        reasons.push(
          `rmseBins ${candidate.metrics.rmseBins.toFixed(4)} worse than default ${baseline.metrics.rmseBins.toFixed(4)}`,
        )
      }
    }

    // clip 边界信息只作诊断，不做准入判断（官方行为：clip 后照用）
    const pinned = await this.pinnedParams(w)

    return {
      accepted: reasons.length === 0,
      reasons,
      items: 0,
      metrics: {
        candidate: candidate?.metrics ?? { logLoss: NaN, rmseBins: NaN },
        default: baseline?.metrics ?? { logLoss: NaN, rmseBins: NaN },
      },
      newCardStability: candidate?.stability ?? {},
      pinned,
    }
  }
}
