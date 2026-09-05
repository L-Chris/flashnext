import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { FsrsStatus } from '../types'

export default function FsrsPanel() {
  const [status, setStatus] = useState<FsrsStatus | null>(null)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setStatus(await api.getFsrsStatus())
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleOptimize = async () => {
    setRunning(true)
    setMessage('')
    try {
      const result = await api.optimizeFsrs()
      setMessage(
        `优化完成：基于 ${result.trainingReviews} 条复习记录（${result.cards} 张卡片），损失 ${result.lossBefore.toFixed(4)} → ${result.lossAfter.toFixed(4)}`,
      )
      await load()
    } catch (error: any) {
      setMessage(error?.message || '优化失败')
    } finally {
      setRunning(false)
    }
  }

  if (!status) return null

  const ready = status.reviewCount >= status.minReviews

  return (
    <section className="mt-8 rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">FSRS 记忆参数</h3>
          <p className="mt-1 text-xs text-zinc-500">
            已记录 {status.reviewCount} 条复习日志
            {status.updatedAt
              ? ` · 上次优化 ${new Date(status.updatedAt).toLocaleString()}`
              : ' · 使用默认参数'}
            {!ready && `（满 ${status.minReviews} 条后可优化）`}
          </p>
        </div>
        <button
          disabled={!ready || running}
          onClick={handleOptimize}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {running ? '优化中...' : '优化参数'}
        </button>
      </div>
      {message && <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">{message}</p>}
    </section>
  )
}
