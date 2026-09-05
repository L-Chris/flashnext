import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { BandStat } from '../types'

export default function WordsView() {
  const [bands, setBands] = useState<BandStat[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<number | null>(null)
  const [message, setMessage] = useState('')

  const loadBands = useCallback(async () => {
    setBands(await api.listBands())
    setLoading(false)
  }, [])

  useEffect(() => {
    loadBands()
  }, [loadBands])

  const handleGenerate = async (band: BandStat) => {
    setGenerating(band.band)
    setMessage('')
    try {
      const result = await api.createDeckFromBand(band.band)
      setMessage(
        result.created > 0
          ? `已生成卡组「${result.deck.name}」，新增 ${result.created} 张卡片，去牌组库开始复习吧`
          : result.synced > 0
            ? `「${result.deck.name}」已同步 ${result.synced} 张卡片内容`
            : `「${result.deck.name}」已是最新，无需更新`,
      )
      await loadBands()
    } finally {
      setGenerating(null)
    }
  }

  if (loading) {
    return <p className="text-center text-zinc-500">加载中...</p>
  }

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-500">
        COCA（美国当代英语语料库）Top 5000 词库，按使用频率分级
      </p>

      {message && (
        <p className="mb-4 rounded-lg border border-emerald-800 bg-emerald-950 px-4 py-3 text-sm text-emerald-300">
          {message}
        </p>
      )}

      <ul className="space-y-3">
        {bands.map(band => {
          const full = band.cardCount >= band.wordCount && band.wordCount > 0
          return (
            <li
              key={band.band}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{band.label}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                    排名 {band.range}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{band.description}</p>
                <p className="mt-1 text-xs text-zinc-400">
                  {band.wordCount} 词
                  {band.cardCount > 0 && (
                    <span className="ml-2 text-indigo-300">已生成 {band.cardCount} 张卡片</span>
                  )}
                </p>
              </div>
              <button
                disabled={generating !== null || full}
                onClick={() => handleGenerate(band)}
                className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                  full
                    ? 'cursor-default bg-zinc-800 text-zinc-500'
                    : 'bg-indigo-600 hover:bg-indigo-500'
                }`}
              >
                {generating === band.band ? '生成中...' : full ? '已生成' : '生成卡组'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
