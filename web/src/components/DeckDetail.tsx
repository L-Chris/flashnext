import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Card, CardPage, CardSortKey, Deck } from '../types'
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
  const [editor, setEditor] = useState<Card | 'new' | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [colOpen, setColOpen] = useState(false)
  const [columns, setColumns] = useState(loadColumnVisibility)
  const [page, setPage] = useState<CardPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState({
    sort: 'difficulty' as CardSortKey,
    dir: 'desc' as 'asc' | 'desc',
    page: 1,
    pageSize: 50,
    q: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPage(await api.listCards(deck.id, query))
    } catch (e) { setError(e instanceof Error ? e.message : '加载失败') } finally {
      setLoading(false)
    }
  }, [deck.id, query])

  useEffect(() => {
    load()
  }, [load])

  // 搜索防抖：单次子串匹配，走服务端分页请求
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(q => (q.q === search.trim() ? q : { ...q, q: search.trim(), page: 1 }))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const handleSort = (key: CardSortKey) => {
    setQuery(q =>
      q.sort === key
        ? { ...q, dir: q.dir === 'asc' ? 'desc' : 'asc', page: 1 }
        : { ...q, sort: key, dir: DEFAULT_DIR[key], page: 1 },
    )
  }


  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 md:grid md:grid-cols-[1fr_auto_1fr] md:gap-2">
        <span className="order-2 flex w-full items-center gap-2 md:order-none md:w-auto md:justify-self-start">
          <button
            onClick={onBack}
            title="返回"
            aria-label="返回"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M19 12H5m0 0l6 6m-6-6l6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索词 / 释义"
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 md:w-56 md:flex-none"
          />
        </span>
        <h2 title={deck.name} className="min-w-0 flex-1 truncate text-xl font-semibold">{deck.name}</h2>
        <span className="flex shrink-0 gap-2 md:justify-self-end">
          <button
            onClick={() => setColOpen(true)}
            title="配置表格列"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            列
          </button>
          <button
            onClick={() => setEditor('new')}
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

      {editor !== null && <CardForm
        deckId={deck.id}
        card={editor === 'new' ? undefined : editor}
        onClose={() => setEditor(null)}
        onSaved={() => { setEditor(null); void load() }}
      />}
      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error} <button onClick={() => void load()} className="underline">重试</button></p>}

      {page && (
        <CardTable
          page={page}
          loading={loading}
          visible={columns}
          onEdit={setEditor}
          onSort={handleSort}
          onPage={p => setQuery(q => ({ ...q, page: p }))}
          onPageSize={size => setQuery(q => ({ ...q, pageSize: size, page: 1 }))}
        />
      )}
    </div>
  )
}
