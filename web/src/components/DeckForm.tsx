import { useState } from 'react'

interface Props {
  onSubmit: (name: string, description: string) => Promise<void>
}

const inputClass =
  'min-w-40 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900'

export default function DeckForm({ onSubmit }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || loading) return
    setLoading(true)
    try {
      await onSubmit(name.trim(), description.trim())
      setName('')
      setDescription('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 flex flex-wrap gap-2">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="牌组名称"
        required
        className={inputClass}
      />
      <input
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="描述（可选）"
        className={inputClass}
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        添加牌组
      </button>
    </form>
  )
}
