import Koa from 'koa'
import logger from 'koa-logger'
import bodyParser from 'koa-bodyparser'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs'
import { STATIC_PATH } from './constants'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const serveStatic = (app: Koa) => {
  app.use(async (ctx, next) => {
    if (ctx.method !== 'GET' || ctx.path.startsWith('/api')) {
      return next()
    }

    const resolved = path.join(STATIC_PATH, ctx.path)
    if (!resolved.startsWith(STATIC_PATH)) return next()

    const tryServe = async (filePath: string): Promise<boolean> => {
      const stats = await fs.promises.stat(filePath).catch(() => null)
      if (!stats || !stats.isFile()) return false

      const ext = path.extname(filePath).toLowerCase()
      if (MIME_TYPES[ext]) ctx.type = MIME_TYPES[ext]

      if (ext === '.html') {
        ctx.set('Cache-Control', 'no-cache')
      } else {
        ctx.set('Cache-Control', 'public, max-age=2592000')
      }

      ctx.body = fs.createReadStream(filePath)
      return true
    }

    if (await tryServe(resolved)) return
    if (await tryServe(path.join(STATIC_PATH, 'index.html'))) return

    return next()
  })
}

export const useMiddlewares = <T extends Koa>(app: T): T => {
  app.use(async (ctx, next) => {
    const traceId = ctx.get('x-trace-id').trim() || randomUUID()
    ctx.state.trace_id = traceId
    ctx.set('X-Trace-Id', traceId)
    await next()
  })

  app.use(logger())
  app.use(bodyParser())

  if (fs.existsSync(STATIC_PATH)) {
    serveStatic(app)
  }

  return app
}
