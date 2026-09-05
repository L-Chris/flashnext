import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Card, Deck } from '../types'
import CardForm from './CardForm'
import CardList from './CardList'

interface Props {
  deck: Deck
  onBack: () => void
  onReview: () => void
}

export default function DeckDetail({ deck, onBack, onReview }: Props) {
  const [cards, setCards] = useState<Card[]>([])

  const loadCards = useCallback(async () => {
    setCards(await api.listCards(deck.id))
  }, [deck.id])

  useEffect(() => {
    loadCards()
  }, [loadCards])

  const handleCreateCard = async (front: string, back: string) => {
    await api.createCard(deck.id, front, back)
    await loadCards()
  }

  const handleDeleteCard = async (id: number) => {
    await api.deleteCard(id)
    await loadCards()
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          &larr; 返回
        </button>
        <h2 className="text-xl font-semibold">{deck.name}</h2>
        <button
          onClick={onReview}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          开始复习
        </button>
      </div>

      <CardForm deckId={deck.id} onSubmit={handleCreateCard} />
      <CardList cards={cards} onDelete={handleDeleteCard} />
    </div>
  )
}
