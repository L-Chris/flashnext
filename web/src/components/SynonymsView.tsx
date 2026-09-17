import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { SynonymPage } from '../types'

const POS_OPTIONS = [
  { value: '', label: '全部词性' },
  { value: 'n', label: 'n.' },
  { value: 'v', label: 'v.' },
  { value: 'a', label: 'a.' },
  { value: 'r', label: 'adv.' },
]

export default function SynonymsView() {
  const [page, setPage] = useState<SynonymPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [pos, setPos] = useState('')
  const [query, setQuery] = useState({ page: 1, pageSize: 50, q: '', pos: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setPage(await api.listSynonymGroups(query))
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(q =>
        q.q === search.trim() && q.pos === pos ? q : { ...q, q: search.trim(), pos, page: 1 },
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search, pos])

  return (
    <div>
      <div className="mb-4 grid grid-cols-[1fr_auto] items-center gap-2">
        <h2 className="text-xl font-semibold">同义词</h2>
        <span className="flex items-center gap-2">
          <select
            value={pos}
            onChange={e => setPos(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {POS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索词 / 释义"
            className="w-40 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 md:w-56"
          />
        </span>
      </div>

      {!page || !page.groups.length ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-zinc-500 dark:border-zinc-800">
          没有匹配的同义词组
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full border-collapse bg-white text-xs dark:bg-zinc-900">
            <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="w-[1%] whitespace-nowrap px-2 py-2 text-left font-medium">成员</th>
                <th className="w-[1%] whitespace-nowrap px-2 py-2 text-left font-medium">中文</th>
                <th className="w-[1%] whitespace-nowrap px-2 py-2 text-left font-medium">词性</th>
                <th className="w-full px-2 py-2 text-left font-medium">释义（WordNet gloss）</th>
              </tr>
            </thead>
            <tbody className={loading ? 'opacity-50' : ''}>
              {page.groups.map(g => (
                <tr key={g.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {g.members.map(m => (
                      <button
                        key={m.headword}
                        onClick={() => setSearch(m.headword)}
                        title={`查看 ${m.headword} 的全部同义组`}
                        className="mr-1 rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
                      >
                        {m.headword}
                      </button>
                    ))}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-zinc-600 dark:text-zinc-400">
                    {g.members.some(m => m.zh)
                      ? g.members
                          .filter(m => m.zh)
                          .map(m => m.zh)
                          .join(' / ')
                      : ''}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-zinc-500">{g.posLabel}</td>
                  <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">
                    <span className="block truncate" title={g.gloss}>
                      {g.gloss}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          <span>
            共 {page.total} 组 · 第 {page.page} / {page.pages} 页
          </span>
          <span className="flex items-center gap-2">
            <button
              disabled={page.page <= 1}
              onClick={() => setQuery(q => ({ ...q, page: q.page - 1 }))}
              className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              上一页
            </button>
            <button
              disabled={page.page >= page.pages}
              onClick={() => setQuery(q => ({ ...q, page: q.page + 1 }))}
              className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              下一页
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
