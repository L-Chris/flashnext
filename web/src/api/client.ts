import type {
  ApiResponse,
  Card,
  CoverageRow,
  Deck,
  DueQueue,
  EnsureResult,
  FsrsStatus,
  OptimizeJob,
  Rating,
  RebuildJob,
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

  listDue: (deckId: number) => request<DueQueue>(`/api/decks/${deckId}/cards/due`),

  createCard: (deckId: number, front: string, back: string) =>
    request<Card>(`/api/decks/${deckId}/cards`, {
      method: 'POST',
      body: JSON.stringify({ front, back }),
    }),

  deleteCard: (id: number) => request<boolean>(`/api/cards/${id}`, { method: 'DELETE' }),

  reviewCard: (id: number, rating: Rating, durationMs = 0) =>
    request<Card>(`/api/cards/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ rating, durationMs }),
    }),

  undoCard: (id: number) => request<Card>(`/api/cards/${id}/undo`, { method: 'POST' }),

  listSchemes: () => request<SchemeInfo[]>('/api/words/tags'),

  getCoverage: (scheme: string) => request<CoverageRow[]>(`/api/words/coverage?scheme=${scheme}`),

  ensureCards: (scheme?: string, level?: number) =>
    request<EnsureResult>('/api/words/cards/ensure', {
      method: 'POST',
      body: JSON.stringify({ scheme, level }),
    }),

  getFsrsStatus: () => request<FsrsStatus>('/api/fsrs/params'),

  setFsrsParams: (w?: number[]) =>
    request<FsrsStatus>('/api/fsrs/params', { method: 'POST', body: JSON.stringify({ w }) }),

  optimizeFsrs: (force = false, timeoutMs?: number) =>
    request<{ started: boolean; reason?: string; job: OptimizeJob }>('/api/fsrs/optimize', {
      method: 'POST',
      body: JSON.stringify({ force, timeoutMs }),
    }),

  optimizeFsrsStatus: () => request<OptimizeJob>('/api/fsrs/optimize'),

  rebuildFsrs: (dryRun = false) =>
    request<{ started: boolean; reason?: string; job: RebuildJob }>('/api/fsrs/rebuild', {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    }),

  rebuildFsrsStatus: () => request<RebuildJob>('/api/fsrs/rebuild'),
}
