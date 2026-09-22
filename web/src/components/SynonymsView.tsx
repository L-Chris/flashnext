import { Fragment, useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { SynonymGroup, SynonymPage } from '../types'

const commonTier = (n: number) => {
  if (n >= 100) return { label: '高', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' }
  if (n >= 10) return { label: '中', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' }
  if (n > 0) return { label: '低', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' }
  return { label: '无', className: 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600' }
}

const MODE_OPTIONS = [
  { value: 'all', label: '默认' },
  { value: 'word', label: '单词' },
  { value: 'definition', label: '释义' },
]

const ExpandedRow = ({ group }: { group: SynonymGroup }) => {
  return (
    <tr className="border-b border-zinc-100 bg-zinc-50/60 dark:border-zinc-800/60 dark:bg-zinc-800/20">
      <td colSpan={4} className="px-3 py-3">
        <table className="w-full border-collapse text-xs">
          <thead className="text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="w-40 px-2 py-1.5 text-left font-medium">单词</th>
              <th className="w-40 px-2 py-1.5 text-left font-medium">中文</th>
              <th className="px-2 py-1.5 text-left font-medium">例句</th>
            </tr>
          </thead>
          <tbody>
            {group.members.map(m => {
              const examples = group.examples.filter(e => e.members.includes(m.headword))
              return (
                <tr key={m.headword} className="border-t border-zinc-200/70 dark:border-zinc-700/50">
                  <td className="px-2 py-1.5 font-medium text-indigo-700 dark:text-indigo-300">
                    {m.headword}
                  </td>
                  <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">{m.zh || '-'}</td>
                  <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">
                    {examples.length ? examples.map(e => e.text).join('　') : '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </td>
    </tr>
  )
}

export default function SynonymsView() {
  const [page, setPage] = useState<SynonymPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState('word')
  const [query, setQuery] = useState({ page: 1, pageSize: 50, q: '', mode: 'word' })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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
        q.q === search.trim() && q.mode === mode ? q : { ...q, q: search.trim(), mode, page: 1 },
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search, mode])

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-[1fr_auto] items-center gap-2">
        <h2 className="text-xl font-semibold">同义词</h2>
        <span className="flex items-center gap-2">
          <select
            value={mode}
            onChange={e => setMode(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {MODE_OPTIONS.map(o => (
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
          <table className="border-collapse bg-white text-xs dark:bg-zinc-900">
            <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="w-[1%] whitespace-nowrap px-2 py-2 text-right font-medium">#</th>
                <th className="px-2 py-2 text-left font-medium">释义</th>
                <th className="w-64 px-2 py-2 text-left font-medium">成员</th>
                <th className="w-[1%] whitespace-nowrap px-2 py-2 text-left font-medium">常见度</th>
              </tr>
            </thead>
            <tbody className={loading ? 'opacity-50' : ''}>
              {page.groups.map((g, i) => (
                <Fragment key={g.id}>
                  <tr
                    onClick={() => toggle(g.id)}
                    className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/30"
                  >
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-zinc-400 dark:text-zinc-600">
                      {(page.page - 1) * page.pageSize + i + 1}
                    </td>
                    <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">
                      <span className="block whitespace-pre" title={g.definition}>
                        {g.definition.replace(/;\s*/g, '\n')}
                      </span>
                    </td>
                    <td className="w-64 px-2 py-1.5">
                      {g.members.map(m => (
                        <button
                          key={m.headword}
                          onClick={e => {
                            e.stopPropagation()
                            setSearch(m.headword)
                          }}
                          title={`查看 ${m.headword} 的全部同义组`}
                          className="mr-1 rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
                        >
                          {m.headword}
                        </button>
                      ))}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {(() => {
                        const tier = commonTier(g.commonness)
                        return (
                          <span
                            title={`平均 SemCor 频次 ${g.commonness}/成员 · 总频次 ${g.semcorTotal}`}
                            className={`rounded px-1.5 py-0.5 ${tier.className}`}
                          >
                            {tier.label}
                          </span>
                        )
                      })()}
                    </td>
                  </tr>
                  {expanded.has(g.id) && <ExpandedRow group={g} />}
                </Fragment>
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
