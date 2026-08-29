import type { Deck } from '../types'

interface Props {
  decks: Deck[]
  onOpen: (deck: Deck) => void
  onDelete: (id: number) => void
}

export default function DeckList({ decks, onOpen, onDelete }: Props) {
  if (decks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
        还没有牌组，创建一个开始学习吧
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {decks.map(deck => (
        <li
          key={deck.id}
          onClick={() => onOpen(deck)}
          className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 hover:border-zinc-600"
        >
          <div>
            <span className="font-medium">{deck.name}</span>
            {deck.description && (
              <span className="ml-2 text-sm text-zinc-500">{deck.description}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {deck.dueCount > 0 && (
              <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs text-indigo-300">
                {deck.dueCount} 待复习
              </span>
            )}
            <button
              onClick={e => {
                e.stopPropagation()
                onDelete(deck.id)
              }}
              className="text-zinc-600 hover:text-red-400"
              aria-label="删除牌组"
            >
              &times;
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
