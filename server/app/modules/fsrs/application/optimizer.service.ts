import { Service } from 'typedi'
import { FsrsRepository } from '../infrastructure/fsrs.repository'
import { ROLLOVER_HOUR, TZ_NAME, fsrsOffsetProvider } from 'app/shared/day-boundary'
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
  private job: OptimizeJob = {
    running: false,
    startedAt: null,
    finishedAt: null,
    force: false,
    result: null,
    error: null,
  }

  constructor(private fsrsRepository: FsrsRepository) {}

  status() {
    return this.job
  }

  /**
   * 训练是分钟级任务，走同步 HTTP 会被反向代理 60s 超时掐断，
   * 因此与 rebuild 一样改成后台 job：POST 立即返回，GET 轮询结果。
   */
  start(options: { force?: boolean; timeoutMs?: number } = {}) {
    if (this.job.running) return { started: false, reason: 'already running', job: this.job }
    this.job = {
      running: true,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      force: Boolean(options.force),
      result: null,
      error: null,
    }
    void this.run(options).catch(error => {
      this.job.running = false
      this.job.finishedAt = new Date().toISOString()
      this.job.error = error?.message || String(error)
    })
    return { started: true, job: this.job }
  }

  private async defaultW(): Promise<number[]> {
    if (!defaultWCache) defaultWCache = [...(await loadFSRS()).default_w]
    return defaultWCache
  }

  async getCurrentW(): Promise<number[]> {
    const row = await this.fsrsRepository.getParamRow()
    if (row) {
      const w = JSON.parse(row.w) as number[]
      if (w.length) return w
    }
    return this.defaultW()
  }

  async getStatus() {
    const row = await this.fsrsRepository.getParamRow()
    const reviewCount = await this.fsrsRepository.countLogs()
    return {
      w: row ? (JSON.parse(row.w) as number[]) : await this.defaultW(),
      source: row?.source ?? 'default',
      updatedAt: row?.updatedAt ?? null,
      revlogMigratedAt: row?.revlogMigratedAt ?? null,
      reviewCount,
      minReviews: MIN_TRAINING_REVIEWS,
      timezone: TZ_NAME,
      rolloverHour: ROLLOVER_HOUR,
    }
  }

  private async buildTrainSet(cardIds?: Set<number>) {
    const binding = await loadBinding()
    const { csv, rows } = await this.fsrsRepository.buildRevlogCsv(cardIds)
    const items = binding.convertCsvToFsrsItems(
      Buffer.from(csv),
      ROLLOVER_HOUR,
      TZ_NAME,
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
  private async run(options: { force?: boolean; timeoutMs?: number } = {}): Promise<OptimizeOutcome> {
    const reviewCount = await this.fsrsRepository.countLogs()
    if (reviewCount < MIN_TRAINING_REVIEWS) {
      throw new Error(`review logs insufficient: ${reviewCount} < ${MIN_TRAINING_REVIEWS}`)
    }

    const row = await this.fsrsRepository.getParamRow()
    if (!row?.revlogMigratedAt) {
      throw new Error(
        'revlog 尚未回填 review_state，先用 POST /api/fsrs/rebuild 重建记忆状态，再训练参数',
      )
    }

    const binding = await loadBinding()
    const { items, rows } = await this.buildTrainSet()
    if (!items.length) {
      throw new Error(`no trainable fsrs items (revlog rows=${rows}); run POST /api/fsrs/rebuild first`)
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
      this.job = { ...this.job, running: false, finishedAt: new Date().toISOString(), result: outcome }
      return outcome
    }

    const source = audit.accepted ? 'official-fsrs-rs' : 'official-forced'
    await this.fsrsRepository.saveParams(w, source)
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
    this.job = { ...this.job, running: false, finishedAt: new Date().toISOString(), result: outcome }
    return outcome
  }

  /**
   * 手工写入 w（可省略以重置为 FSRS-6 官方默认值）。
   * 用于两种情况：训练数据来自别的调度器导致官方优化结果退化时回退默认值；
   * 或直接粘贴 Anki「Optimize」得到的参数。
   */
  async setParams(w?: number[], withAudit = false) {
    const manual = Array.isArray(w) && w.length > 0
    const target = manual ? (w as number[]).map(Number) : await this.defaultW()
    if (!target.length || target.some(v => !Number.isFinite(v))) {
      throw new Error('invalid weights')
    }
    await this.fsrsRepository.saveParams(target, manual ? 'manual' : 'default')
    clearSchedulerCache()
    const audit = withAudit ? await this.auditParameters(target).catch(e => ({ error: String(e?.message || e) })) : null
    return { ...(await this.getStatus()), audit }
  }

  /** 只评估、不落库，用于预览/诊断 */
  async auditParameters(w: number[], cardIds?: Set<number>): Promise<Audit> {
    const binding = await loadBinding()
    const { items } = await this.buildTrainSet(cardIds)
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
