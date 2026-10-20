import type {
  ApiResponse,
  Card,
  CardContentBody,
  ContentFormat,
  ContentPreview,
  MediaAsset,
  CardPage,
  CardPageQuery,
  CoverageRow,
  DailyLimits,
  Deck,
  DueQueue,
  EnsureResult,
  FsrsStatus,
  OptimizeJob,
  Rating,
  RebuildJob,
  SchemeInfo,
  SynonymPage,
} from '../types'

const request = async <T>(url: string, options: RequestInit = {}): Promise<T> => {
  const res = await fetch(url, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
  })
  const body: ApiResponse<T> = await res.json().catch(() => { throw new Error(`服务器返回异常（${res.status}），请稍后重试`) })
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

  listCards: (deckId: number, query: Partial<CardPageQuery> = {}) => {
    const params = new URLSearchParams()
    if (query.sort) params.set('sort', query.sort)
    if (query.dir) params.set('dir', query.dir)
    if (query.page) params.set('page', String(query.page))
    if (query.pageSize) params.set('pageSize', String(query.pageSize))
    if (query.q) params.set('q', query.q)
    const qs = params.toString()
    return request<CardPage>(`/api/decks/${deckId}/cards${qs ? `?${qs}` : ''}`)
  },

  listDue: (deckId: number, signal?: AbortSignal) => request<DueQueue>(`/api/decks/${deckId}/cards/due`, { signal }),

  createCard: (deckId: number, content: CardContentBody) =>
    request<Card>(`/api/decks/${deckId}/cards`, { method: 'POST', body: JSON.stringify(content) }),

  editCard: (id: number, content: CardContentBody) =>
    request<Card>(`/api/cards/${id}`, { method: 'PATCH', body: JSON.stringify(content) }),

  uploadAudio: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<MediaAsset>('/api/media', { method: 'POST', body })
  },

  previewContent: (front: string, back: string, contentFormat: ContentFormat, signal?: AbortSignal) =>
    request<ContentPreview>('/api/content/preview', { method: 'POST', body: JSON.stringify({ front, back, contentFormat }), signal }),

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

  getFsrsStatus: (deckId: number) => request<FsrsStatus>(`/api/decks/${deckId}/fsrs/params`),

  setFsrsParams: (deckId: number, w?: number[]) =>
    request<FsrsStatus>(`/api/decks/${deckId}/fsrs/params`, { method: 'POST', body: JSON.stringify({ w }) }),

  optimizeFsrs: (deckId: number, force = false, timeoutMs?: number) =>
    request<{ started: boolean; reason?: string; job: OptimizeJob }>(`/api/decks/${deckId}/fsrs/optimize`, {
      method: 'POST',
      body: JSON.stringify({ force, timeoutMs }),
    }),

  optimizeFsrsStatus: (deckId: number) => request<OptimizeJob>(`/api/decks/${deckId}/fsrs/optimize`),

  rebuildFsrs: (deckId: number, dryRun = false) =>
    request<{ started: boolean; reason?: string; job: RebuildJob }>(`/api/decks/${deckId}/fsrs/rebuild`, {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    }),

  rebuildFsrsStatus: (deckId: number) => request<RebuildJob>(`/api/decks/${deckId}/fsrs/rebuild`),

  listSynonymGroups: (query: {
    page?: number
    pageSize?: number
    q?: string
    mode?: string
    hideRare?: boolean
  } = {}) => {
    const params = new URLSearchParams()
    if (query.page) params.set('page', String(query.page))
    if (query.pageSize) params.set('pageSize', String(query.pageSize))
    if (query.q) params.set('q', query.q)
    if (query.mode && query.mode !== 'all') params.set('mode', query.mode)
    if (query.hideRare) params.set('hideRare', '1')
    const qs = params.toString()
    return request<SynonymPage>(`/api/synonyms/groups${qs ? `?${qs}` : ''}`)
  },

  getSettings: (deckId: number) => request<DailyLimits>(`/api/decks/${deckId}/settings`),

  saveSettings: (deckId: number, limits: Partial<DailyLimits>) =>
    request<DailyLimits>(`/api/decks/${deckId}/settings`, { method: 'POST', body: JSON.stringify(limits) }),
}
