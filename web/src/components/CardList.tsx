import type { Card } from '../types'

interface Props {
  cards: Card[]
  onDelete: (id: number) => void
}

const TAG_COLORS: Record<string, string> = {
  coca: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  cet: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
}

export default function CardList({ cards, onDelete }: Props) {
  if (cards.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-zinc-500 dark:border-zinc-800">
        这个牌组还没有卡片
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {cards.map(card => (
        <li
          key={card.id}
          className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              {card.front} <span className="text-zinc-400 dark:text-zinc-600">&rarr;</span>{' '}
              {card.back}
            </span>
            {card.word?.tags.map(tag => (
              <span
                key={`${tag.scheme}-${tag.level}`}
                className={`rounded px-1.5 py-0.5 text-xs ${
                  TAG_COLORS[tag.scheme] || 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {tag.label}
              </span>
            ))}
          </span>
          <button
            onClick={() => onDelete(card.id)}
            className="text-zinc-400 hover:text-red-500 dark:text-zinc-600 dark:hover:text-red-400"
            aria-label="删除卡片"
          >
            &times;
          </button>
        </li>
      ))}
    </ul>
  )
}
