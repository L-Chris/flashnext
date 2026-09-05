import { useState } from 'react'

interface Props {
  deckId: number
  onSubmit: (front: string, back: string) => Promise<void>
}

const inputClass =
  'min-w-40 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900'

export default function CardForm({ deckId, onSubmit }: Props) {
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!front.trim() || !back.trim() || loading) return
    setLoading(true)
    try {
      await onSubmit(front.trim(), back.trim())
      setFront('')
      setBack('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 flex flex-wrap gap-2">
      <input
        key={`${deckId}-front`}
        value={front}
        onChange={e => setFront(e.target.value)}
        placeholder="正面（问题）"
        required
        className={inputClass}
      />
      <input
        key={`${deckId}-back`}
        value={back}
        onChange={e => setBack(e.target.value)}
        placeholder="背面（答案）"
        required
        className={inputClass}
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        添加卡片
      </button>
    </form>
  )
}
