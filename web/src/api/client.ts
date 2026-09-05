import type {
  ApiResponse,
  Card,
  CoverageRow,
  Deck,
  EnsureResult,
  FsrsStatus,
  OptimizeResult,
  Rating,
  SchemeInfo,
} from '../types'

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

  reviewCard: (id: number, rating: Rating) =>
    request<Card>(`/api/cards/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ rating }),
    }),

  listSchemes: () => request<SchemeInfo[]>('/api/words/tags'),

  getCoverage: (scheme: string) => request<CoverageRow[]>(`/api/words/coverage?scheme=${scheme}`),

  ensureCards: (scheme?: string, level?: number) =>
    request<EnsureResult>('/api/words/cards/ensure', {
      method: 'POST',
      body: JSON.stringify({ scheme, level }),
    }),

  getFsrsStatus: () => request<FsrsStatus>('/api/fsrs/params'),

  optimizeFsrs: () => request<OptimizeResult>('/api/fsrs/optimize', { method: 'POST' }),
}
