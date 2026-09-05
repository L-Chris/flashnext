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
  front: string
  back: string
  ease: number
  interval: number
  reps: number
  due: string
  createdAt: string
}

export interface ApiResponse<T> {
  message: string
  data: T
}

export type Grade = 0 | 1 | 2 | 3 | 4 | 5

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
}
