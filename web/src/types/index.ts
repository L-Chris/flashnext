export interface Deck {
  id: number
  name: string
  description: string
  createdAt: string
  dueCount: number
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
}

export interface ApiResponse<T> {
  message: string
  data: T
}

export type Rating = 1 | 2 | 3 | 4

export interface BandStat {
  band: number
  label: string
  range: string
  description: string
  wordCount: number
  cardCount: number
}

export interface Word {
  id: number
  headword: string
  rank: number
  band: number
  pos: string
  phonetic: string
  translation: string
}

export interface WordPage {
  words: Word[]
  total: number
  page: number
  pageSize: number
}

export interface FromBandResult {
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
