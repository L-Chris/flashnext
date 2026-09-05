import { useCallback, useEffect, useState } from 'react'
import { api } from './api/client'
import type { Deck } from './types'
import DeckList from './components/DeckList'
import DeckForm from './components/DeckForm'
import DeckDetail from './components/DeckDetail'
import ReviewView from './components/ReviewView'
import WordsView from './components/WordsView'
import FsrsPanel from './components/FsrsPanel'

type View =
  | { type: 'decks' }
  | { type: 'deck'; deck: Deck }
  | { type: 'review'; deck: Deck }
  | { type: 'words' }

type Theme = 'light' | 'dark'

const initialTheme = (): Theme => {
  const stored = localStorage.getItem('flashnext-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function App() {
  const [view, setView] = useState<View>({ type: 'decks' })
  const [decks, setDecks] = useState<Deck[]>([])
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('flashnext-theme', theme)
  }, [theme])

  const loadDecks = useCallback(async () => {
    setDecks(await api.listDecks())
  }, [])

  useEffect(() => {
    loadDecks()
  }, [loadDecks])

  const handleCreateDeck = async (name: string, description: string) => {
    await api.createDeck(name, description)
    await loadDecks()
  }

  const handleDeleteDeck = async (id: number) => {
    await api.deleteDeck(id)
    await loadDecks()
  }

  const tab = view.type === 'words' ? 'words' : 'decks'

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      <header className="relative mb-6 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Flash<span className="text-indigo-500 dark:text-indigo-400">Next</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">下一代间隔重复记忆工具</p>
        <button
          onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
          className="absolute right-0 top-0 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          {theme === 'dark' ? '浅色模式' : '深色模式'}
        </button>
      </header>

      <nav className="mb-6 flex gap-1 rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={() => {
            setView({ type: 'decks' })
            loadDecks()
          }}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            tab === 'decks' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          牌组库
        </button>
        <button
          onClick={() => setView({ type: 'words' })}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            tab === 'words' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          COCA 词库
        </button>
      </nav>

      {view.type === 'words' && <WordsView />}

      {view.type === 'decks' && (
        <>
          <DeckForm onSubmit={handleCreateDeck} />
          <DeckList
            decks={decks}
            onOpen={deck => setView({ type: 'deck', deck })}
            onDelete={handleDeleteDeck}
          />
          <FsrsPanel />
        </>
      )}

      {view.type === 'deck' && (
        <DeckDetail
          deck={view.deck}
          onBack={() => {
            setView({ type: 'decks' })
            loadDecks()
          }}
          onReview={() => setView({ type: 'review', deck: view.deck })}
        />
      )}

      {view.type === 'review' && (
        <ReviewView
          deck={view.deck}
          onExit={() => setView({ type: 'deck', deck: view.deck })}
        />
      )}
    </div>
  )
}
