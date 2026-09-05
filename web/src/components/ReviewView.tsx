import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Card, Deck, Grade } from '../types'

interface Props {
  deck: Deck
  onExit: () => void
}

const GRADE_BUTTONS: Array<{ grade: Grade; label: string; className: string }> = [
  { grade: 0, label: '忘记', className: 'bg-red-600 hover:bg-red-500' },
  { grade: 3, label: '困难', className: 'bg-amber-600 hover:bg-amber-500' },
  { grade: 4, label: '良好', className: 'bg-emerald-600 hover:bg-emerald-500' },
  { grade: 5, label: '简单', className: 'bg-sky-600 hover:bg-sky-500' },
]

export default function ReviewView({ deck, onExit }: Props) {
  const [queue, setQueue] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [revealed, setRevealed] = useState(false)
  const [grading, setGrading] = useState(false)

  useEffect(() => {
    api.listDue(deck.id).then(cards => {
      setQueue(cards)
      setLoading(false)
    })
  }, [deck.id])

  const current = queue[0]

  const handleGrade = useCallback(
    async (grade: Grade) => {
      if (!current || grading) return
      setGrading(true)
      try {
        await api.reviewCard(current.id, grade)
        setQueue(prev => prev.slice(1))
        setRevealed(false)
      } finally {
        setGrading(false)
      }
    },
    [current, grading],
  )

  if (loading) {
    return <p className="text-center text-zinc-500">加载中...</p>
  }

  if (queue.length === 0) {
    return (
      <div className="text-center">
        <p className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900 p-10 text-zinc-400">
          太棒了！当前牌组没有需要复习的卡片
        </p>
        <button
          onClick={onExit}
          className="rounded-lg bg-zinc-800 px-6 py-2 text-sm hover:bg-zinc-700"
        >
          返回牌组
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between text-sm text-zinc-500">
        <span>剩余 {queue.length} 张</span>
        <button onClick={onExit} className="hover:text-zinc-200">
          退出复习
        </button>
      </div>

      <div className="mb-4 flex min-h-52 flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <p className="text-2xl font-medium">{current.front}</p>
        {revealed && (
          <p className="mt-4 whitespace-pre-line text-left text-xl text-emerald-400">
            {current.back}
          </p>
        )}
      </div>

      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="w-full rounded-lg bg-indigo-600 py-3 font-medium hover:bg-indigo-500"
        >
          显示答案
        </button>
      ) : (
        <div className="flex gap-2">
          {GRADE_BUTTONS.map(({ grade, label, className }) => (
            <button
              key={grade}
              disabled={grading}
              onClick={() => handleGrade(grade)}
              className={`flex-1 rounded-lg py-3 text-sm font-medium disabled:opacity-50 ${className}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
