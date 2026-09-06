import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { FsrsStatus, OptimizeJob, OptimizeResult, RebuildJob } from '../types'

const SOURCE_LABEL: Record<string, string> = {
  default: 'FSRS-6 官方默认',
  manual: '手工写入',
  'official-fsrs-rs': 'fsrs-rs 训练',
  'official-forced': 'fsrs-rs 训练（强制）',
  legacy: '旧版自研优化（已废弃）',
}

export default function FsrsPanel() {
  const [status, setStatus] = useState<FsrsStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [optimize, setOptimize] = useState<OptimizeResult | null>(null)
  const [job, setJob] = useState<RebuildJob | null>(null)
  const [trainJob, setTrainJob] = useState<OptimizeJob | null>(null)
  const timer = useRef<number | null>(null)
  const trainTimer = useRef<number | null>(null)

  const load = useCallback(async () => {
    setStatus(await api.getFsrsStatus())
    setJob(await api.rebuildFsrsStatus())
  }, [])

  useEffect(() => {
    load()
    return () => {
      if (timer.current) window.clearInterval(timer.current)
      if (trainTimer.current) window.clearInterval(trainTimer.current)
    }
  }, [load])

  useEffect(() => {
    if (!job?.running) return
    timer.current = window.setInterval(async () => {
      const next = await api.rebuildFsrsStatus()
      setJob(next)
      if (!next.running && timer.current) {
        window.clearInterval(timer.current)
        await load()
      }
    }, 1000)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [job?.running, load])

  const applyOutcome = useCallback(
    async (result: OptimizeResult | null, error: string | null) => {
      setOptimize(result)
      if (error) {
        setMessage(`训练失败：${error}`)
        return
      }
      if (!result) return
      setMessage(
        result.saved
          ? `已写入训练参数（${result.audit.items} 个训练样本，耗时 ${Math.round(result.elapsedMs / 1000)}s）`
          : `训练结果比默认参数差，未写入：${result.audit.reasons.join('；')}`,
      )
      if (result.saved) await load()
    },
    [load],
  )

  const pollTrain = useCallback(() => {
    if (trainTimer.current) window.clearInterval(trainTimer.current)
    trainTimer.current = window.setInterval(async () => {
      const next = await api.optimizeFsrsStatus()
      setTrainJob(next)
      if (!next.running) {
        if (trainTimer.current) window.clearInterval(trainTimer.current)
        setRunning(false)
        await applyOutcome(next.result, next.error)
      }
    }, 1500)
  }, [applyOutcome])

  const handleOptimize = async (force = false) => {
    setRunning(true)
    setMessage('')
    setOptimize(null)
    try {
      const started = await api.optimizeFsrs(force)
      if (!started.started) {
        setMessage(started.reason === 'already running' ? '训练任务已在进行中' : '无法启动训练')
        setRunning(false)
        return
      }
      setTrainJob(started.job)
      pollTrain()
    } catch (error: any) {
      setMessage(error?.message || '优化失败')
      setRunning(false)
    }
  }

  if (!status) return null

  const ready = status.reviewCount >= status.minReviews
  const migrated = Boolean(status.revlogMigratedAt)

  return (
    <section className="mt-8 rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">FSRS 记忆参数</h3>
          <p className="mt-1 text-xs text-zinc-500">
            当前来源：{SOURCE_LABEL[status.source] || status.source} · {status.w.length} 维
            {status.updatedAt ? ` · 更新于 ${new Date(status.updatedAt).toLocaleString()}` : ''}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            日切点 {String(status.rolloverHour).padStart(2, '0')}:00（{status.timezone}）· 复习日志{' '}
            {status.reviewCount} 条
            {!ready && `（满 ${status.minReviews} 条后可训练）`}
          </p>
        </div>
        <button
          disabled={!ready || !migrated || running}
          onClick={() => handleOptimize(false)}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {running ? '训练中...' : '训练参数'}
        </button>
      </div>

      {!migrated && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          复习日志缺少复习当时的卡片状态，无法训练。请执行 POST /api/fsrs/rebuild 重建记忆状态。
        </p>
      )}

      {trainJob?.running && (
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          训练中（fsrs-rs 官方优化器，约 1-2 分钟，可离开本页面）...
        </p>
      )}

      {job?.running && (
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          重建进度：{job.progress.cards}/{job.progress.totalCards} 张卡片 ·{' '}
          {job.progress.logs}/{job.progress.totalLogs} 条复习
        </p>
      )}

      {job?.error && <p className="mt-3 text-xs text-red-600">重建失败：{job.error}</p>}

      {job?.result && !job.running && (
        <div className="mt-3 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          <p>
            上次重建：{job.result.cards} 张卡 · {job.result.logs} 条日志 ·{' '}
            {(job.result.elapsedMs / 1000).toFixed(1)}s · 今日到期 {job.result.dueTodayBefore} →{' '}
            {job.result.dueTodayAfter}
          </p>
          <p>
            interval p50 {job.result.intervalPercentiles.p50}d / p90{' '}
            {job.result.intervalPercentiles.p90}d / max {job.result.intervalPercentiles.max}d · 最远{' '}
            {new Date(job.result.maxDue).toLocaleDateString()}
          </p>
        </div>
      )}

      {message && (
        <p
          className={`mt-3 text-xs ${
            optimize && !optimize.saved
              ? 'text-amber-700 dark:text-amber-400'
              : 'text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {message}
        </p>
      )}

      {optimize && (
        <div className="mt-2 space-y-1 text-xs text-zinc-500">
          <p>
            logLoss {optimize.audit.metrics.candidate?.logLoss?.toFixed(4)}（默认{' '}
            {optimize.audit.metrics.default?.logLoss?.toFixed(4)}）· rmseBins{' '}
            {optimize.audit.metrics.candidate?.rmseBins?.toFixed(4)}（默认{' '}
            {optimize.audit.metrics.default?.rmseBins?.toFixed(4)}）
          </p>
          <p>
            新卡初始 stability：
            {Object.entries(optimize.audit.newCardStability)
              .map(([g, v]) => `${g}=${Number(v).toFixed(1)}d`)
              .join(' ')}
            {optimize.audit.pinned.length > 0 && ` · 触边界：${optimize.audit.pinned.join(' ')}`}
          </p>
          {!optimize.saved && (
            <button
              disabled={running}
              onClick={() => handleOptimize(true)}
              className="mt-1 rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              仍然采用这组参数
            </button>
          )}
        </div>
      )}
    </section>
  )
}
