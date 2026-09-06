export interface DueUsage {
  newCount: number
  reviewCount: number
  newLimit: number
  reviewLimit: number
  newRemaining: number
  reviewRemaining: number
}

export interface DueCounts {
  intraday: number
  review: number
  fresh: number
  queued?: number
  hiddenByLimit: number
}

export interface Deck {
  id: number
  name: string
  description: string
  createdAt: string
  dueCount: number
  counts?: DueCounts
  usage?: DueUsage
}

export interface DueQueue {
  cards: Card[]
  usage: DueUsage
  counts: DueCounts
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
  source: string
  updatedAt: string | null
  revlogMigratedAt: string | null
  reviewCount: number
  minReviews: number
  timezone: string
  rolloverHour: number
}

export interface FsrsAudit {
  accepted: boolean
  reasons: string[]
  items: number
  metrics: Record<string, { logLoss: number; rmseBins: number }>
  newCardStability: Record<string, number>
  pinned: string[]
}

export interface OptimizeResult {
  saved: boolean
  source?: string
  forced: boolean
  w: number[]
  audit: FsrsAudit
  rows: number
  elapsedMs: number
}

export interface OptimizeJob {
  running: boolean
  startedAt: string | null
  finishedAt: string | null
  force: boolean
  result: OptimizeResult | null
  error: string | null
}

export interface RebuildResult {
  cards: number
  logs: number
  dryRun: boolean
  elapsedMs: number
  w: number[]
  dueTodayBefore: number
  dueTodayAfter: number
  intervalPercentiles: Record<string, number>
  maxDue: string
  forecast: Array<{ day: string; due: number }>
  stateHistogram: Record<string, number>
}

export interface RebuildJob {
  running: boolean
  startedAt: string | null
  finishedAt: string | null
  dryRun: boolean
  progress: { cards: number; totalCards: number; logs: number; totalLogs: number }
  result: RebuildResult | null
  error: string | null
}
