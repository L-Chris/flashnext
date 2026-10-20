import type { Deck } from '../types'

interface Props {
  decks: Deck[]
  onOpen: (deck: Deck) => void
  onSettings: (deck: Deck) => void
}

export default function DeckList({ decks, onOpen, onSettings }: Props) {
  if (decks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-800">
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
          className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
        >
          <div>
            <span className="font-medium">{deck.name}</span>
            {deck.description && (
              <span className="ml-2 text-sm text-zinc-500">{deck.description}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {deck.dueCount > 0 && (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                {deck.dueCount} 待复习
              </span>
            )}
            <button
              onClick={e => {
                e.stopPropagation()
                onSettings(deck)
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              aria-label={`${deck.name}设置`}
              title={`${deck.name}设置`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="m9.6 3-.6 2a7 7 0 0 0-1.8 1l-2-.5-2.4 4.1 1.5 1.5a7 7 0 0 0 0 2l-1.5 1.5L5.2 19l2-.5A7 7 0 0 0 9 19.5l.6 2h4.8l.6-2a7 7 0 0 0 1.8-1l2 .5 2.4-4.1-1.5-1.5a7 7 0 0 0 0-2l1.5-1.5L18.8 6l-2 .5A7 7 0 0 0 15 5.5l-.6-2h-4.8Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
