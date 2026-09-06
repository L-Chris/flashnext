import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Card, Deck, DueCounts, DueUsage, Rating } from '../types'

interface Props {
  deck: Deck
  onExit: () => void
}

const RATING_BUTTONS: Array<{ rating: Rating; label: string; className: string }> = [
  { rating: 1, label: '忘记', className: 'bg-red-600 hover:bg-red-500' },
  { rating: 2, label: '困难', className: 'bg-amber-600 hover:bg-amber-500' },
  { rating: 3, label: '良好', className: 'bg-emerald-600 hover:bg-emerald-500' },
  { rating: 4, label: '简单', className: 'bg-sky-600 hover:bg-sky-500' },
]

export default function ReviewView({ deck, onExit }: Props) {
  const [queue, setQueue] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [revealed, setRevealed] = useState(false)
  const [grading, setGrading] = useState(false)
  const [usage, setUsage] = useState<DueUsage | null>(null)
  const [counts, setCounts] = useState<DueCounts | null>(null)
  const [graded, setGraded] = useState<number[]>([])
  const shownAt = useRef(Date.now())

  useEffect(() => {
    api.listDue(deck.id).then(data => {
      setQueue(data.cards)
      setUsage(data.usage)
      setCounts(data.counts)
      setLoading(false)
    })
  }, [deck.id])

  const current = queue[0]
  const currentId = current?.id

  useEffect(() => {
    shownAt.current = Date.now()
  }, [currentId])

  const handleGrade = useCallback(
    async (rating: Rating) => {
      if (!current || grading) return
      setGrading(true)
      try {
        await api.reviewCard(current.id, rating, Date.now() - shownAt.current)
        setGraded(prev => [current.id, ...prev])
        setQueue(prev => prev.slice(1))
        setRevealed(false)
      } finally {
        setGrading(false)
      }
    },
    [current, grading],
  )

  const handleUndo = useCallback(async () => {
    const id = graded[0]
    if (!id || grading) return
    setGrading(true)
    try {
      const card = await api.undoCard(id)
      setGraded(prev => prev.slice(1))
      setQueue(prev => [card, ...prev])
      setRevealed(false)
    } finally {
      setGrading(false)
    }
  }, [graded, grading])

  if (loading) {
    return <p className="text-center text-zinc-500">加载中...</p>
  }

  if (queue.length === 0) {
    return (
      <div className="text-center">
        <p className="mb-6 rounded-lg border border-zinc-200 bg-white p-10 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          太棒了！当前牌组没有需要复习的卡片
        </p>
        <button
          onClick={onExit}
          className="rounded-lg bg-zinc-200 px-6 py-2 text-sm text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          返回牌组
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between text-sm text-zinc-500">
        <span>
          剩余 {queue.length} 张
          {counts && (
            <span className="ml-2 text-xs">
              新 {counts.fresh} · 复习 {counts.review + counts.intraday}
              {counts.hiddenByLimit > 0 && ` · 今日已达上限，隐藏 ${counts.hiddenByLimit}`}
            </span>
          )}
          {usage && (
            <span className="ml-2 text-xs">
              今日已复习 {usage.reviewCount}/{usage.reviewLimit} · 新卡{' '}
              {usage.newCount}/{usage.newLimit}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          {graded.length > 0 && (
            <button
              disabled={grading}
              onClick={handleUndo}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              撤销上次评分
            </button>
          )}
          <button onClick={onExit} className="hover:text-zinc-800 dark:hover:text-zinc-200">
            退出复习
          </button>
        </span>
      </div>

      <div className="mb-4 flex min-h-52 flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-2xl font-medium">{current.front}</p>
        {revealed &&
          (() => {
            const lines = current.back.split('\n')
            const hasPhonetic = lines[0]?.startsWith('/')
            const phonetic = hasPhonetic ? lines[0] : ''
            const meanings = (hasPhonetic ? lines.slice(1) : lines).join('\n')
            return (
              <div className="mt-4 text-xl text-emerald-700 dark:text-emerald-400">
                {phonetic && <p className="text-center">{phonetic}</p>}
                {meanings && (
                  <div
                    className={`grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-left ${
                      phonetic ? 'mt-5' : ''
                    }`}
                  >
                    {meanings.split('\n').map((line, i) => {
                      const m = line.match(/^([a-z&]+\.\s*)(.*)$/)
                      if (!m) {
                        return (
                          <span key={i} className="col-span-2">
                            {line}
                          </span>
                        )
                      }
                      return (
                        <Fragment key={i}>
                          <span className="text-emerald-600/80 dark:text-emerald-500/80">
                            {m[1].trim()}
                          </span>
                          <span>{m[2]}</span>
                        </Fragment>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}
      </div>

      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="w-full rounded-lg bg-indigo-600 py-3 font-medium text-white hover:bg-indigo-500"
        >
          显示答案
        </button>
      ) : (
        <div className="flex gap-2">
          {RATING_BUTTONS.map(({ rating, label, className }) => (
            <button
              key={rating}
              disabled={grading}
              onClick={() => handleGrade(rating)}
              className={`flex-1 rounded-lg py-3 text-sm font-medium text-white disabled:opacity-50 ${className}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
