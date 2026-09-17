import { useCallback, useEffect, useState } from 'react'
import { api } from './api/client'
import type { Deck } from './types'
import DeckList from './components/DeckList'
import DeckForm from './components/DeckForm'
import DeckDetail from './components/DeckDetail'
import ReviewView from './components/ReviewView'
import WordsView from './components/WordsView'
import SynonymsView from './components/SynonymsView'
import FsrsPanel from './components/FsrsPanel'

type View =
  | { type: 'decks' }
  | { type: 'deck'; deck: Deck }
  | { type: 'review'; deck: Deck }
  | { type: 'words' }
  | { type: 'synonyms' }

type Theme = 'light' | 'dark'

const initialTheme = (): Theme => {
  const stored = localStorage.getItem('flashnext-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const Logo = () => (
  <span className="flex items-center gap-2">
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
      F
    </span>
    <span className="text-lg font-bold tracking-tight">
      Flash<span className="text-indigo-500 dark:text-indigo-400">Next</span>
    </span>
  </span>
)

export default function App() {
  const [view, setView] = useState<View>({ type: 'decks' })
  const [decks, setDecks] = useState<Deck[]>([])
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [deckAddOpen, setDeckAddOpen] = useState(false)
  const [fsrsOpen, setFsrsOpen] = useState(false)

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

  const tab = view.type === 'words' ? 'words' : view.type === 'synonyms' ? 'synonyms' : 'decks'

  const navItems: Array<{ key: 'decks' | 'words' | 'synonyms'; label: string; onClick: () => void }> = [
    {
      key: 'decks',
      label: '牌组库',
      onClick: () => {
        setView({ type: 'decks' })
        loadDecks()
      },
    },
    {
      key: 'words',
      label: '词库',
      onClick: () => setView({ type: 'words' }),
    },
    {
      key: 'synonyms',
      label: '同义词',
      onClick: () => setView({ type: 'synonyms' }),
    },
  ]

  const navClass = (active: boolean) =>
    `w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
      active
        ? 'bg-indigo-600 text-white'
        : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
    }`

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* 移动端顶栏 */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900 md:hidden">
        <Logo />
        <nav className="flex gap-1">
          {navItems.map(item => (
            <button
              key={item.key}
              onClick={item.onClick}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === item.key
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {/* 侧边导航 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 md:flex">
        <div className="px-4 py-5">
          <Logo />
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {navItems.map(item => (
            <button key={item.key} onClick={item.onClick} className={navClass(tab === item.key)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
          <button
            onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <span aria-hidden>{theme === 'dark' ? '☀' : '☾'}</span>
            {theme === 'dark' ? '浅色模式' : '深色模式'}
          </button>
        </div>
      </aside>

      {/* 主体 */}
      <main className="md:pl-56">
        <div className="w-full px-5 py-8 md:py-10">
          {view.type === 'words' && <WordsView />}

          {view.type === 'synonyms' && <SynonymsView />}

          {view.type === 'decks' && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold">牌组库</h2>
                <span className="flex items-center gap-2">
                  <button
                    onClick={() => setDeckAddOpen(true)}
                    className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
                  >
                    添加
                  </button>
                  <button
                  onClick={() => setFsrsOpen(true)}
                  title="FSRS 设置"
                  aria-label="FSRS 设置"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"
                    />
                  </svg>
                  </button>
                </span>
              </div>
              <DeckList
                decks={decks}
                onOpen={deck => setView({ type: 'deck', deck })}
                onDelete={handleDeleteDeck}
              />
              <DeckForm
                open={deckAddOpen}
                onClose={() => setDeckAddOpen(false)}
                onSubmit={handleCreateDeck}
              />
              {fsrsOpen && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
                  onClick={() => setFsrsOpen(false)}
                >
                  <div
                    onClick={e => e.stopPropagation()}
                    className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold">设置</h3>
                      <button
                        onClick={() => setFsrsOpen(false)}
                        aria-label="关闭"
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        &times;
                      </button>
                    </div>
                    <FsrsPanel />
                  </div>
                </div>
              )}
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
      </main>

      <button
        onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
        title={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
        aria-label="切换主题"
        className="fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-lg shadow-lg hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 md:hidden"
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </div>
  )
}
