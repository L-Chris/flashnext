import { useEffect, useState } from 'react'

interface Props {
  deckId: number
  open: boolean
  onClose: () => void
  onSubmit: (front: string, back: string) => Promise<void>
}

const inputClass =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900'

export default function CardForm({ deckId, open, onClose, onSubmit }: Props) {
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setFront('')
      setBack('')
    }
  }, [open, deckId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!front.trim() || !back.trim() || loading) return
    setLoading(true)
    try {
      await onSubmit(front.trim(), back.trim())
      onClose()
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <>
      {(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={onClose}
        >
          <form
            onSubmit={handleSubmit}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h3 className="mb-3 text-sm font-semibold">添加卡片</h3>
            <label className="mb-1 block text-xs text-zinc-500">正面（问题）</label>
            <input
              autoFocus
              value={front}
              onChange={e => setFront(e.target.value)}
              placeholder="正面（问题）"
              required
              className={inputClass}
            />
            <label className="mb-1 mt-3 block text-xs text-zinc-500">背面（答案）</label>
            <textarea
              value={back}
              onChange={e => setBack(e.target.value)}
              placeholder="背面（答案），可多行"
              required
              rows={4}
              className={`${inputClass} resize-y`}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {loading ? '添加中...' : '添加'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
