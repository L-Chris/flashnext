import path from 'path'

export const PORT = Number(process.env.PORT) || 3000
export const ENV_LABEL = process.env.NODE_ENV || 'development'
export const DATABASE_URL =
  process.env.DATABASE_URL || 'file:./data/flashnext.db'

export const STATIC_PATH =
  process.env.STATIC_PATH || path.join(__dirname, '..', '..', 'web', 'dist')

const envInt = (name: string, fallback: number): number => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

export const DESIRED_RETENTION = Number(process.env.FLASHNEXT_DESIRED_RETENTION) || 0.9
export const MAXIMUM_INTERVAL = envInt('FLASHNEXT_MAXIMUM_INTERVAL', 36500)
export const RELEARNING_STEPS = ['10m'] as const
export const NEW_CARDS_PER_DAY = envInt('FLASHNEXT_NEW_PER_DAY', 20)
export const REVIEWS_PER_DAY = envInt('FLASHNEXT_REVIEWS_PER_DAY', 200)
export const OPTIMIZE_TIMEOUT_MS = envInt('FLASHNEXT_OPTIMIZE_TIMEOUT_MS', 60000)
export const MIN_TRAINING_REVIEWS = envInt('FLASHNEXT_MIN_TRAINING_REVIEWS', 1000)
