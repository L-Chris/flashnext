import type { Card as FSRSCard, IFSRS } from 'ts-fsrs' with { 'resolution-mode': 'import' }

export interface StoredCardState {
  due: Date
  stability: number
  difficulty: number
  state: number
  reps: number
  lapses: number
  learningSteps: number
  interval: number
  lastReview: Date | null
}

let cache: { key: string; scheduler: IFSRS } | null = null

export const warmupFSRS = async (): Promise<void> => {
  await import('ts-fsrs')
}

const getScheduler = async (w: number[]): Promise<IFSRS> => {
  const key = w.join(',')
  if (cache && cache.key === key) return cache.scheduler
  const { fsrs, generatorParameters } = await import('ts-fsrs')
  const scheduler = fsrs(generatorParameters({ w }))
  cache = { key, scheduler }
  return scheduler
}

export const toFSRSCard = (stored: StoredCardState): FSRSCard => ({
  due: stored.due,
  stability: stored.stability,
  difficulty: stored.difficulty,
  elapsed_days: 0,
  scheduled_days: stored.interval,
  learning_steps: stored.learningSteps,
  reps: stored.reps,
  lapses: stored.lapses,
  state: stored.state as FSRSCard['state'],
  last_review: stored.lastReview ?? undefined,
})

export const scheduleReview = async (
  stored: StoredCardState,
  rating: 1 | 2 | 3 | 4,
  w: number[],
): Promise<FSRSCard> => {
  const scheduler = await getScheduler(w)
  const preview = scheduler.repeat(toFSRSCard(stored), new Date())
  return preview[rating].card
}
