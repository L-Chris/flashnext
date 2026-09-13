import type { Card, CardPage, CardSortKey } from '../types'

export interface TableColumn {
  key: string
  label: string
  title?: string
  sortKey?: CardSortKey
  fixed?: boolean
  defaultVisible: boolean
  render: (card: Card) => React.ReactNode
}

const STATE_LABEL: Record<number, { label: string; className: string }> = {
  0: { label: '新', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  1: { label: '学习', className: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' },
  2: { label: '复习', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  3: { label: '重学', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
}

const TAG_COLORS: Record<string, string> = {
  coca: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  cet: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
}

const rClass = (card: Card) => {
  if (!card.reps || card.retrievability === undefined || card.retrievability >= 0.999)
    return 'text-zinc-400 dark:text-zinc-600'
  if (card.retrievability < 0.7) return 'text-red-600 dark:text-red-400'
  if (card.retrievability < 0.9) return 'text-amber-600 dark:text-amber-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

const dueText = (card: Card) => {
  const overdue = card.overdueDays ?? 0
  const isIntraday = card.interval === 0 && card.state !== 2
  if (isIntraday) {
    return {
      text: new Date(card.due).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      className: 'text-sky-600 dark:text-sky-400',
    }
  }
  if (overdue > 0) return { text: `逾期${overdue}天`, className: 'text-red-600 dark:text-red-400' }
  if (overdue === 0) return { text: '今天', className: 'text-amber-600 dark:text-amber-400' }
  return { text: `${-overdue}天后`, className: 'text-zinc-500 dark:text-zinc-500' }
}

export const TABLE_COLUMNS: TableColumn[] = [
  { key: 'front', label: '词', fixed: true, defaultVisible: true, render: c => <span className="font-medium">{c.front}</span> },
  {
    key: 'phonetic',
    label: '音标',
    defaultVisible: false,
    render: c => <span className="text-zinc-500 dark:text-zinc-400">{c.word?.phonetic ? `/${c.word.phonetic}/` : ''}</span>,
  },
  {
    key: 'translation',
    label: '释义',
    defaultVisible: true,
    render: c => (
      <span className="block max-w-56 truncate text-zinc-600 dark:text-zinc-400" title={c.word?.translation}>
        {c.word?.translation}
      </span>
    ),
  },
  {
    key: 'tags',
    label: '分级',
    defaultVisible: true,
    render: c => (
      <>
        {c.word?.tags.map(tag => (
          <span
            key={`${tag.scheme}-${tag.level}`}
            title={tag.label}
            className={`mr-1 rounded px-1.5 py-0.5 ${TAG_COLORS[tag.scheme] || 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}
          >
            {tag.scheme === 'coca' ? tag.label.split(/\s/)[0] : tag.label}
          </span>
        ))}
      </>
    ),
  },
  { key: 'rank', label: 'rank', title: 'COCA 词频排名，越小越核心', sortKey: 'rank', defaultVisible: true, render: c => <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{c.word?.rank ?? '—'}</span> },
  { key: 'stability', label: 'S', title: '记忆稳定性（天）', sortKey: 'stability', defaultVisible: true, render: c => <span className="tabular-nums">{c.stability.toFixed(1)}</span> },
  { key: 'difficulty', label: 'D', title: 'FSRS 难度（1-10）', sortKey: 'difficulty', defaultVisible: true, render: c => <span className="tabular-nums">{c.difficulty.toFixed(2)}</span> },
  {
    key: 'retrievability',
    label: 'R',
    title: '当前回忆概率',
    sortKey: 'retrievability',
    defaultVisible: true,
    render: c => <span className={`tabular-nums ${rClass(c)}`}>{c.reps ? (c.retrievability ?? 0).toFixed(2) : '—'}</span>,
  },
  {
    key: 'lapseRate',
    label: '失忆率',
    title: '遗忘次数 / 复习次数',
    sortKey: 'lapseRate',
    defaultVisible: true,
    render: c => (
      <span className={`tabular-nums ${c.lapseRate ? 'text-amber-600 dark:text-amber-400' : ''}`}>
        {c.reps ? `${Math.round((c.lapseRate ?? 0) * 100)}%` : '—'}
      </span>
    ),
  },
  {
    key: 'state',
    label: '状态',
    defaultVisible: true,
    render: c => {
      const s = STATE_LABEL[c.state] ?? STATE_LABEL[0]
      return <span className={`rounded px-1.5 py-0.5 ${s.className}`}>{s.label}</span>
    },
  },
  {
    key: 'interval',
    label: '间隔',
    title: '当前间隔（天）',
    defaultVisible: false,
    render: c => <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{c.interval > 0 ? `${c.interval}d` : '—'}</span>,
  },
  {
    key: 'due',
    label: '到期',
    title: '逾期天数 / 到期日',
    defaultVisible: false,
    render: c => {
      const d = dueText(c)
      return <span className={`whitespace-nowrap tabular-nums ${d.className}`}>{d.text}</span>
    },
  },
  { key: 'reps', label: 'reps', title: '复习次数', defaultVisible: true, render: c => <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{c.reps}</span> },
  { key: 'lapses', label: 'lapses', title: '遗忘次数', defaultVisible: true, render: c => <span className="tabular-nums text-zinc-600 dark:text-zinc-400">{c.lapses}</span> },
  {
    key: 'lastReview',
    label: '上次复习',
    defaultVisible: true,
    render: c => (
      <span className="whitespace-nowrap text-zinc-500 dark:text-zinc-500">
        {c.lastReview ? new Date(c.lastReview).toLocaleDateString('zh-CN') : '—'}
      </span>
    ),
  },
]

const STORAGE_KEY = 'flashnext-card-columns'

export const defaultColumnVisibility = (): Record<string, boolean> =>
  Object.fromEntries(TABLE_COLUMNS.map(c => [c.key, c.defaultVisible]))

export const loadColumnVisibility = (): Record<string, boolean> => {
  const base = defaultColumnVisibility()
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, boolean>
    for (const key of Object.keys(base)) {
      if (typeof stored[key] === 'boolean') base[key] = stored[key]
    }
  } catch {
    /* ignore */
  }
  return base
}

export const saveColumnVisibility = (v: Record<string, boolean>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
}

export function ColumnConfigModal({
  visible,
  onChange,
  onClose,
}: {
  visible: Record<string, boolean>
  onChange: (next: Record<string, boolean>) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-xs rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h3 className="mb-3 text-sm font-semibold">表格列显示</h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {TABLE_COLUMNS.filter(c => !c.fixed).map(c => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={visible[c.key] ?? true}
                onChange={e => onChange({ ...visible, [c.key]: e.target.checked })}
                className="accent-indigo-600"
              />
              {c.label}
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-between">
          <button
            onClick={() => onChange(defaultColumnVisibility())}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            恢复默认
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  page: CardPage
  loading: boolean
  visible: Record<string, boolean>
  onSort: (key: CardSortKey) => void
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  onDelete: (id: number) => void
}

const Th = ({
  label,
  title,
  active,
  dir,
  onClick,
}: {
  label: string
  title?: string
  active?: boolean
  dir?: 'asc' | 'desc'
  onClick?: () => void
}) => (
  <th
    title={title}
    onClick={onClick}
    className={`whitespace-nowrap px-2 py-2 text-left font-medium ${
      onClick ? 'cursor-pointer select-none hover:text-zinc-900 dark:hover:text-zinc-100' : ''
    } ${active ? 'text-indigo-600 dark:text-indigo-400' : ''}`}
  >
    {label}
    {active && <span className="ml-0.5">{dir === 'asc' ? '↑' : '↓'}</span>}
  </th>
)

export default function CardTable({ page, loading, visible, onSort, onPage, onPageSize, onDelete }: Props) {
  const columns = TABLE_COLUMNS.filter(c => c.fixed || visible[c.key])

  if (!page.cards.length) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-zinc-500 dark:border-zinc-800">
        这个牌组还没有卡片
      </p>
    )
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full border-collapse bg-white text-xs dark:bg-zinc-900">
          <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <tr>
              {columns.map(c => (
                <Th
                  key={c.key}
                  label={c.label}
                  title={c.title}
                  active={c.sortKey !== undefined && page.sort === c.sortKey}
                  dir={page.dir}
                  onClick={c.sortKey ? () => onSort(c.sortKey!) : undefined}
                />
              ))}
              <Th label="" />
            </tr>
          </thead>
          <tbody className={loading ? 'opacity-50' : ''}>
            {page.cards.map(card => (
              <tr key={card.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                {columns.map(c => (
                  <td key={c.key} className="whitespace-nowrap px-2 py-1.5">
                    {c.render(card)}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={() => onDelete(card.id)}
                    className="text-zinc-400 hover:text-red-500 dark:text-zinc-600 dark:hover:text-red-400"
                    aria-label="删除卡片"
                  >
                    &times;
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          共 {page.total} 张 · 第 {page.page} / {page.pages} 页
        </span>
        <span className="flex items-center gap-2">
          <select
            value={page.pageSize}
            onChange={e => onPageSize(Number(e.target.value))}
            className="rounded border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {[20, 50, 100, 200].map(n => (
              <option key={n} value={n}>
                {n} / 页
              </option>
            ))}
          </select>
          <button
            disabled={page.page <= 1}
            onClick={() => onPage(page.page - 1)}
            className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            上一页
          </button>
          <button
            disabled={page.page >= page.pages}
            onClick={() => onPage(page.page + 1)}
            className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            下一页
          </button>
        </span>
      </div>
    </div>
  )
}
