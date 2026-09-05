export interface Deck {
  id: number
  name: string
  description: string
  createdAt: string
  dueCount: number
}

export interface WordTag {
  id?: number
  wordId?: number
  scheme: string
  level: number
  label: string
}

export interface Word {
  id: number
  headword: string
  rank: number | null
  pos: string
  phonetic: string
  translation: string
  tags: WordTag[]
}

export interface Card {
  id: number
  deckId: number
  wordId: number | null
  front: string
  back: string
  stability: number
  difficulty: number
  state: number
  reps: number
  lapses: number
  learningSteps: number
  interval: number
  due: string
  lastReview: string | null
  createdAt: string
  word?: { id: number; headword: string; tags: WordTag[] } | null
}

export interface ApiResponse<T> {
  message: string
  data: T
}

export type Rating = 1 | 2 | 3 | 4

export interface SchemeLevel {
  level: number
  label: string
  description?: string
}

export interface SchemeInfo {
  scheme: string
  name: string
  levels: SchemeLevel[]
  taggedCount: number
}

export interface CoverageRow {
  level: number | null
  label: string
  description?: string
  wordTotal: number
  cardCount: number
  studiedCount: number
  dueCount: number
  coverage: number
}

export interface EnsureResult {
  deck: Deck
  created: number
  synced: number
}

export interface FsrsStatus {
  w: number[]
  updatedAt: string | null
  reviewCount: number
  minReviews: number
}

export interface OptimizeResult {
  w: number[]
  lossBefore: number
  lossAfter: number
  trainingReviews: number
  cards: number
}
