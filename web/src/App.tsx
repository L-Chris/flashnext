import { useCallback, useEffect, useState } from 'react'
import { api } from './api/client'
import type { Deck } from './types'
import DeckList from './components/DeckList'
import DeckForm from './components/DeckForm'
import DeckDetail from './components/DeckDetail'
import ReviewView from './components/ReviewView'
import WordsView from './components/WordsView'
import SynonymsView from './components/SynonymsView'
import DeckSettingsDialog from './components/DeckSettingsDialog'
import GlobalSettingsDialog from './components/GlobalSettingsDialog'

type Route =
  | { type: 'decks' }
  | { type: 'deck'; id: number }
  | { type: 'review'; id: number }
  | { type: 'words' }
  | { type: 'synonyms' }

type Theme = 'light' | 'dark'

const initialTheme = (): Theme => {
  const stored = localStorage.getItem('flashnext-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const hashOf = (route: Route): string => {
  switch (route.type) {
    case 'deck': return `#/deck/${route.id}`
    case 'review': return `#/review/${route.id}`
    case 'words': return '#/words'
    case 'synonyms': return '#/synonyms'
    default: return '#/decks'
  }
}

const parseHash = (): Route => {
  const [seg, param] = window.location.hash.replace(/^#\/?/, '').split('/')
  const id = Number(param)
  if (seg === 'deck' && Number.isFinite(id) && id > 0) return { type: 'deck', id }
  if (seg === 'review' && Number.isFinite(id) && id > 0) return { type: 'review', id }
  if (seg === 'words') return { type: 'words' }
  if (seg === 'synonyms') return { type: 'synonyms' }
  return { type: 'decks' }
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
  const [route, setRoute] = useState<Route>(parseHash)
  const [decks, setDecks] = useState<Deck[]>([])
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [deckAddOpen, setDeckAddOpen] = useState(false)
  const [settingsDeck, setSettingsDeck] = useState<Deck | null>(null)
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false)
  const [settingsRevision, setSettingsRevision] = useState(0)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('flashnext-theme', theme)
  }, [theme])

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = (next: Route) => {
    const hash = hashOf(next)
    if (window.location.hash === hash) setRoute(next)
    else window.location.hash = hash
  }

  const loadDecks = useCallback(async () => {
    setDecks(await api.listDecks())
  }, [])
  const globalSaved = useCallback(async () => { await loadDecks(); setSettingsRevision(value => value + 1) }, [loadDecks])

  useEffect(() => {
    loadDecks()
  }, [loadDecks])

  const handleCreateDeck = async (name: string, description: string) => {
    await api.createDeck(name, description)
    await loadDecks()
  }

  // 路由指向的牌组尚未加载或已删除时回落到牌组列表
  const routeDeck =
    route.type === 'deck' || route.type === 'review'
      ? decks.find(d => d.id === route.id) ?? null
      : null
  useEffect(() => {
    if ((route.type === 'deck' || route.type === 'review') && decks.length && !routeDeck) {
      navigate({ type: 'decks' })
    }
  }, [route, decks, routeDeck])

  const tab =
    route.type === 'words' ? 'words' : route.type === 'synonyms' ? 'synonyms' : 'decks'

  const navItems: Array<{ key: 'decks' | 'words' | 'synonyms'; label: string; onClick: () => void }> = [
    { key: 'decks', label: '牌组库', onClick: () => navigate({ type: 'decks' }) },
    { key: 'words', label: '词库', onClick: () => navigate({ type: 'words' }) },
    { key: 'synonyms', label: '同义词', onClick: () => navigate({ type: 'synonyms' }) },
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
        <button aria-label="全局设置" onClick={() => setGlobalSettingsOpen(true)} className="shrink-0 rounded-md p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">⚙</button>
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
          <button onClick={() => setGlobalSettingsOpen(true)} aria-label="全局设置" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
            <span aria-hidden>⚙</span>设置
          </button>
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
          {route.type === 'words' && <WordsView />}

          {route.type === 'synonyms' && <SynonymsView />}

          {route.type === 'decks' && (
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
                </span>
              </div>
              <DeckList
                decks={decks}
                onOpen={deck => navigate({ type: 'deck', id: deck.id })}
                onSettings={setSettingsDeck}
              />
              <DeckForm
                open={deckAddOpen}
                onClose={() => setDeckAddOpen(false)}
                onSubmit={handleCreateDeck}
              />
              {settingsDeck && (
                <DeckSettingsDialog key={settingsDeck.id} deck={settingsDeck} onClose={() => setSettingsDeck(null)} onSaved={loadDecks} />
              )}
            </>
          )}

          {route.type === 'deck' && routeDeck && (
            <DeckDetail key={routeDeck.id}
              deck={routeDeck}
              onBack={() => navigate({ type: 'decks' })}
              onReview={() => navigate({ type: 'review', id: routeDeck.id })}
            />
          )}

          {route.type === 'review' && routeDeck && (
            <ReviewView key={`${routeDeck.id}:${settingsRevision}`}
              deck={routeDeck}
              onExit={() => navigate({ type: 'deck', id: routeDeck.id })}
            />
          )}
        </div>
      </main>
      {globalSettingsOpen && <GlobalSettingsDialog onClose={() => setGlobalSettingsOpen(false)} onSaved={globalSaved} />}
    </div>
  )
}
