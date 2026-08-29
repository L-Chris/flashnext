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
