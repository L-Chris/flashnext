import type { Card } from '../types'

interface Props {
  cards: Card[]
  onDelete: (id: number) => void
}

export default function CardList({ cards, onDelete }: Props) {
  if (cards.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-zinc-500">
        这个牌组还没有卡片
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {cards.map(card => (
        <li
          key={card.id}
          className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
        >
          <span className="text-sm">
            {card.front} <span className="text-zinc-600">&rarr;</span> {card.back}
          </span>
          <button
            onClick={() => onDelete(card.id)}
            className="text-zinc-600 hover:text-red-400"
            aria-label="删除卡片"
          >
            &times;
          </button>
        </li>
      ))}
    </ul>
  )
}
