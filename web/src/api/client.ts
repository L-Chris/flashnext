import type { ApiResponse, Card, Deck, Grade } from '../types'

const request = async <T>(url: string, options: RequestInit = {}): Promise<T> => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const body: ApiResponse<T> = await res.json()
  if (res.status >= 400 || body.data === false) {
    throw new Error((body as any).message || `request failed: ${res.status}`)
  }
  return body.data
}

export const api = {
  listDecks: () => request<Deck[]>('/api/decks'),

  createDeck: (name: string, description: string) =>
    request<Deck>('/api/decks', { method: 'POST', body: JSON.stringify({ name, description }) }),

  deleteDeck: (id: number) => request<boolean>(`/api/decks/${id}`, { method: 'DELETE' }),

  listCards: (deckId: number) => request<Card[]>(`/api/decks/${deckId}/cards`),

  listDue: (deckId: number) => request<Card[]>(`/api/decks/${deckId}/cards/due`),

  createCard: (deckId: number, front: string, back: string) =>
    request<Card>(`/api/decks/${deckId}/cards`, {
      method: 'POST',
      body: JSON.stringify({ front, back }),
    }),

  deleteCard: (id: number) => request<boolean>(`/api/cards/${id}`, { method: 'DELETE' }),

  reviewCard: (id: number, grade: Grade) =>
    request<Card>(`/api/cards/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ grade }),
    }),
}
