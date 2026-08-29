import { useCallback, useEffect, useState } from 'react'
import { api } from './api/client'
import type { Deck } from './types'
import DeckList from './components/DeckList'
import DeckForm from './components/DeckForm'
import DeckDetail from './components/DeckDetail'
import ReviewView from './components/ReviewView'

type View =
  | { type: 'decks' }
  | { type: 'deck'; deck: Deck }
  | { type: 'review'; deck: Deck }

export default function App() {
  const [view, setView] = useState<View>({ type: 'decks' })
  const [decks, setDecks] = useState<Deck[]>([])

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

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Flash<span className="text-indigo-400">Next</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-500">下一代间隔重复记忆工具</p>
      </header>

      {view.type === 'decks' && (
        <>
          <DeckForm onSubmit={handleCreateDeck} />
          <DeckList
            decks={decks}
            onOpen={deck => setView({ type: 'deck', deck })}
            onDelete={handleDeleteDeck}
          />
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
