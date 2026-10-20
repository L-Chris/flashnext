export interface WordPronunciation {
  id: number
  pos: string
  usage: string
  accent: string
  displayIpa: string
  rawIpa: string
  status: string
  source: string
}

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
  language?: string
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
  reviewOptions?: ReviewOptions
  usage: DueUsage
  counts: DueCounts
}

export interface IeltsUsage {
  id: number
  chapter: string
  displayWord: string
  pos: string
  meaning: string
  phonetic: string
  sourceUrl: string
  phoneticProfile?: string
}

export interface WordSense {
  id: number
  wordId: number
  senseIdx: number
  gloss: string
  glossLanguage?: string
  exampleDetails?: string
  examples: string
  zh: string
}

export interface WordTag {
  id?: number
  wordId?: number
  scheme: string
  level: number
  label: string
}

export interface Word {
  language?: string
  reading?: string
  romaji?: string
  id: number
  headword: string
  rank: number | null
  pos: string
  phonetic: string
  translation: string
  tags: WordTag[]
}

export type ContentFormat = 'plain' | 'markdown_math'
export type CardSide = 'front' | 'back'
export interface MediaAsset {
  id: string
  mimeType: string
  bytes: number
  originalName: string
  createdAt: string
  url: string
}
export interface CardMedia extends MediaAsset {
  mediaId: string
  side: CardSide
  position: number
}
export interface CardContentBody {
  front: string
  back: string
  contentFormat: ContentFormat
  media: Array<{ mediaId: string; side: CardSide; position: number }>
}
export interface ReviewOptions {
  audioAutoplay: boolean
  showNewCardAnswerImmediately: boolean
  autoRevealAnswerSeconds: number | null
  settingsVersion: number
}
export interface ContentDiagnostic { message: string; offset: number; line: number; column: number }
export interface RenderedFace { html: string; errors: ContentDiagnostic[] }
export interface ContentPreview {
  contentFormat: ContentFormat
  front: RenderedFace
  back: RenderedFace
  valid: boolean
  renderer: { name: string; version: string; cssUrl: string }
}

export interface Card {
  id: number
  deckId: number
  wordId: number | null
  front: string
  back: string
  contentFormat?: ContentFormat
  media?: CardMedia[]
  presentation?: { audioAutoplay: boolean; answerRevealAfterMs: number | null; settingsVersion: number }
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
  word?: {
    language?: string
    reading?: string
    pos?: string
    romaji?: string
    id: number
    headword: string
    rank?: number | null
    phonetic?: string
    phoneticProfile?: string
    pronunciations?: WordPronunciation[]
    translation?: string
    tags: WordTag[]
    senses?: WordSense[]
    ieltsUsages?: IeltsUsage[]
  } | null
  retrievability?: number
  overdueDays?: number
  lapseRate?: number
}

export interface SynonymMember {
  headword: string
  zh: string
}

export interface SynonymExample {
  text: string
  members: string[]
}

export interface SynonymGroup {
  id: string
  pos: string
  posLabel: string
  gloss: string
  definition: string
  examples: SynonymExample[]
  commonness: number
  semcorTotal: number
  members: SynonymMember[]
}

export interface SynonymPage {
  groups: SynonymGroup[]
  total: number
  page: number
  pages: number
  pageSize: number
}

export type CardSortKey =
  | 'rank'
  | 'stability'
  | 'difficulty'
  | 'retrievability'
  | 'lapseRate'
  | 'overdue'
  | 'due'
  | 'reps'
  | 'lapses'
  | 'lastReview'
  | 'createdAt'
  | 'state'
  | 'interval'
  | 'headword'

export interface CardPageQuery {
  sort: CardSortKey
  dir: 'asc' | 'desc'
  page: number
  pageSize: number
  q?: string
}

export interface CardPage {
  cards: Card[]
  total: number
  page: number
  pageSize: number
  pages: number
  sort: CardSortKey
  dir: 'asc' | 'desc'
  q: string
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
  readyCount?: number
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

export interface DailyLimits {
  audioAutoplay: boolean
  showNewCardAnswerImmediately: boolean
  autoRevealAnswerSeconds: number | null
  deckId: number
  timezone: string
  rolloverHour: number
  version: number
  newPerDay: number
  reviewPerDay: number
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
