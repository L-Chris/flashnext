import path from 'path'

export const PORT = Number(process.env.PORT) || 3000
export const ENV_LABEL = process.env.NODE_ENV || 'development'
export const DATABASE_URL =
  process.env.DATABASE_URL || 'file:./data/flashnext.db'

export const STATIC_PATH =
  process.env.STATIC_PATH || path.join(__dirname, '..', '..', 'web', 'dist')
