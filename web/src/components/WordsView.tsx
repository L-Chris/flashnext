import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { CoverageRow, SchemeInfo } from '../types'

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

export default function WordsView() {
  const [schemes, setSchemes] = useState<SchemeInfo[]>([])
  const [scheme, setScheme] = useState('')
  const [rows, setRows] = useState<CoverageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const loadSchemes = useCallback(async () => {
    const list = await api.listSchemes()
    setSchemes(list)
    setScheme(prev => (prev && list.some(s => s.scheme === prev) ? prev : list[0]?.scheme ?? ''))
    return list
  }, [])

  const loadCoverage = useCallback(async (s: string) => {
    if (!s) return
    setRows(await api.getCoverage(s))
    setLoading(false)
  }, [])

  useEffect(() => {
    loadSchemes()
  }, [loadSchemes])

  useEffect(() => {
    setLoading(true)
    loadCoverage(scheme)
  }, [scheme, loadCoverage])

  const handleEnsure = async (level?: number) => {
    const key = level === undefined ? 'all' : String(level)
    setBusy(key)
    setMessage('')
    try {
      const result = await api.ensureCards(level === undefined ? undefined : scheme, level)
      setMessage(
        result.created > 0
          ? `已补建 ${result.created} 张卡片到「${result.deck.name}」` +
              (result.synced > 0 ? `，同步 ${result.synced} 张` : '')
          : result.synced > 0
            ? `已同步 ${result.synced} 张卡片内容`
            : '卡片已是最新',
      )
      await loadCoverage(scheme)
    } catch (error: any) {
      setMessage(error?.message || '操作失败')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <p className="text-center text-zinc-500">加载中...</p>
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
          {schemes.map(s => (
            <button
              key={s.scheme}
              onClick={() => setScheme(s.scheme)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                scheme === s.scheme
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              {s.name}
              <span className="ml-1 text-xs opacity-70">{s.taggedCount}</span>
            </button>
          ))}
        </div>
        <button
          disabled={busy !== null}
          onClick={() => handleEnsure(undefined)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy === 'all' ? '补建中...' : '补建全部缺卡'}
        </button>
      </div>

      {message && (
        <p className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {message}
        </p>
      )}

      <ul className="space-y-3">
        {rows.map(row => {
          const key = row.level === null ? 'none' : String(row.level)
          const full = row.wordTotal > 0 && row.cardCount >= row.wordTotal
          return (
            <li
              key={key}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{row.label}</span>
                  {row.description && (
                    <span className="text-xs text-zinc-500">{row.description}</span>
                  )}
                </div>
                <button
                  disabled={busy !== null || full || row.wordTotal === 0 || row.level === null}
                  onClick={() => handleEnsure(row.level ?? undefined)}
                  className={`shrink-0 rounded-lg px-4 py-1.5 text-sm font-medium disabled:opacity-50 ${
                    full
                      ? 'cursor-default bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500'
                      : 'bg-indigo-600 text-white hover:bg-indigo-500'
                  }`}
                >
                  {busy === key ? '补建中...' : full ? '已建全' : '补建本级'}
                </button>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: pct(row.coverage) }}
                />
              </div>

              <p className="mt-2 text-xs text-zinc-500">
                卡片 {row.cardCount}/{row.wordTotal}（{pct(row.coverage)}） · 已学{' '}
                {row.studiedCount} · 待复习 {row.dueCount}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
