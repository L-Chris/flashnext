import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { CardPage, CardSortKey, Deck } from '../types'
import CardForm from './CardForm'
import CardTable, {
  ColumnConfigModal,
  loadColumnVisibility,
  saveColumnVisibility,
} from './CardTable'

interface Props {
  deck: Deck
  onBack: () => void
  onReview: () => void
}

const DEFAULT_DIR: Record<CardSortKey, 'asc' | 'desc'> = {
  rank: 'asc',
  stability: 'desc',
  difficulty: 'desc',
  retrievability: 'asc',
  lapseRate: 'desc',
  overdue: 'desc',
  due: 'asc',
  reps: 'desc',
  lapses: 'desc',
  lastReview: 'desc',
  createdAt: 'desc',
  state: 'asc',
  interval: 'desc',
  headword: 'asc',
}

export default function DeckDetail({ deck, onBack, onReview }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [colOpen, setColOpen] = useState(false)
  const [columns, setColumns] = useState(loadColumnVisibility)
  const [page, setPage] = useState<CardPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState({ sort: 'overdue' as CardSortKey, dir: 'desc' as 'asc' | 'desc', page: 1, pageSize: 50 })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setPage(await api.listCards(deck.id, query))
    } finally {
      setLoading(false)
    }
  }, [deck.id, query])

  useEffect(() => {
    load()
  }, [load])

  const handleSort = (key: CardSortKey) => {
    setQuery(q =>
      q.sort === key
        ? { ...q, dir: q.dir === 'asc' ? 'desc' : 'asc', page: 1 }
        : { ...q, sort: key, dir: DEFAULT_DIR[key], page: 1 },
    )
  }

  const handleCreateCard = async (front: string, back: string) => {
    await api.createCard(deck.id, front, back)
    await load()
  }

  const handleDeleteCard = async (id: number) => {
    await api.deleteCard(id)
    await load()
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          &larr; 返回
        </button>
        <h2 className="text-xl font-semibold">{deck.name}</h2>
        <span className="flex gap-2">
          <button
            onClick={() => setColOpen(true)}
            title="配置表格列"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            列
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            添加
          </button>
          <button
            onClick={onReview}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            复习
          </button>
        </span>
      </div>

      {colOpen && (
        <ColumnConfigModal
          visible={columns}
          onChange={next => {
            setColumns(next)
            saveColumnVisibility(next)
          }}
          onClose={() => setColOpen(false)}
        />
      )}

      <CardForm
        deckId={deck.id}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreateCard}
      />

      {page && (
        <CardTable
          page={page}
          loading={loading}
          visible={columns}
          onSort={handleSort}
          onPage={p => setQuery(q => ({ ...q, page: p }))}
          onPageSize={size => setQuery(q => ({ ...q, pageSize: size, page: 1 }))}
          onDelete={handleDeleteCard}
        />
      )}
    </div>
  )
}
