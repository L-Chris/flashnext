import { Service } from 'typedi'
import { HttpError } from 'routing-controllers'
import type { IncomingMessage } from 'node:http'
import type { Context } from 'koa'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import busboy from 'busboy'
import { prisma } from 'app/shared/prisma'

const maximum = Number(process.env.FLASHNEXT_MEDIA_MAX_BYTES || 20 * 1024 * 1024)
if (!Number.isSafeInteger(maximum) || maximum < 1024 || maximum > 100 * 1024 * 1024) throw new Error('FLASHNEXT_MEDIA_MAX_BYTES 必须为 1024–104857600')
const databasePath = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5).split('?')[0] : null
export const MEDIA_ROOT = path.resolve(process.env.FLASHNEXT_MEDIA_DIR || (databasePath && path.isAbsolute(databasePath) ? path.join(path.dirname(databasePath), 'media') : path.join(process.cwd(), 'data', 'media')))
const allowed = new Map([
  ['mp3', 'audio/mpeg'], ['m4a', 'audio/mp4'], ['wav', 'audio/wav'], ['ogg', 'audio/ogg'], ['opus', 'audio/ogg'],
])
export const mediaView = (asset: { id: string; mimeType: string; bytes: number; originalName: string; createdAt: Date }) => ({
  id: asset.id, mimeType: asset.mimeType, bytes: asset.bytes, originalName: asset.originalName,
  createdAt: asset.createdAt, url: `/api/media/${asset.id}/content`,
})

@Service()
export class MediaService {
  private async persist(file: NodeJS.ReadableStream & { truncated?: boolean }, filename: string, signal: AbortSignal) {
    const id = randomUUID(), temporary = path.join(MEDIA_ROOT, '.tmp', id)
    const hash = createHash('sha256')
    let bytes = 0, finalPath: string | null = null
    try {
      const meter = new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; hash.update(chunk); done(null, chunk) } })
      await pipeline(file, meter, fs.createWriteStream(temporary, { flags: 'wx' }), { signal })
      if (file.truncated || bytes > maximum) throw new HttpError(413, `音频文件不能超过 ${maximum} 字节`)
      if (!bytes) throw new HttpError(400, '音频文件不能为空')
      let detected: { ext: string; mime: string } | undefined
      try { detected = await (await import('file-type')).fileTypeFromFile(temporary) } catch { /* Invalid or truncated file signature. */ }
      if (!detected || !allowed.has(detected.ext) || !detected.mime.startsWith('audio/')) throw new HttpError(415, '只支持实际为 MP3、M4A、WAV 或 OGG 的音频文件')
      const sha256 = hash.digest('hex')
      const existing = await prisma.mediaAsset.findUnique({ where: { sha256 } })
      if (existing) {
        const stored = path.join(MEDIA_ROOT, existing.storageKey)
        if (!await fs.promises.stat(stored).catch(() => null)) await fs.promises.copyFile(temporary, stored, fs.constants.COPYFILE_EXCL).catch(error => { if (error.code !== 'EEXIST') throw error })
        return { asset: existing, created: false }
      }
      const extension = detected.ext === 'opus' ? 'ogg' : detected.ext
      const storageKey = `${id}.${extension}`
      finalPath = path.join(MEDIA_ROOT, storageKey)
      await fs.promises.rename(temporary, finalPath)
      const originalName = path.basename((filename || '').replace(/\\/g, '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 240) || `audio.${extension}`
      try {
        const asset = await prisma.mediaAsset.create({ data: { id, storageKey, sha256, mimeType: allowed.get(detected.ext)!, bytes, originalName } })
        finalPath = null // File is now owned by the database row.
        return { asset, created: true }
      } catch (error) {
        if (error?.code !== 'P2002') throw error
        const winner = await prisma.mediaAsset.findUnique({ where: { sha256 } })
        if (!winner) throw error
        return { asset: winner, created: false }
      }
    } finally {
      await fs.promises.unlink(temporary).catch(() => {})
      if (finalPath) await fs.promises.unlink(finalPath).catch(() => {})
    }
  }

  async upload(req: IncomingMessage) {
    if (!/^multipart\/form-data\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, '请使用 multipart/form-data 的 file 字段上传音频')
    if (Number(req.headers['content-length']) > maximum + 65536) throw new HttpError(413, '上传文件过大')
    await fs.promises.mkdir(path.join(MEDIA_ROOT, '.tmp'), { recursive: true })
    let parser: ReturnType<typeof busboy>
    try { parser = busboy({ headers: req.headers, defParamCharset: 'utf8', limits: { files: 1, fields: 0, parts: 2, fileSize: maximum + 1, headerPairs: 64 } }) }
    catch { throw new HttpError(400, '无效的 multipart 请求或 boundary') }
    let problem: Error | null = null
    let task: ReturnType<MediaService['persist']> | null = null
    const abort = new AbortController()
    const onAbort = () => { abort.abort(); parser.destroy(new Error('上传中断')) }
    req.once('aborted', onAbort)
    try {
      await new Promise<void>((resolve, reject) => {
        parser.on('file', (name, file, info) => {
          if (name !== 'file') { problem = new HttpError(400, '音频必须使用 file 字段'); file.resume(); return }
          task = this.persist(file, info.filename, abort.signal).catch(error => { problem = error; return null })
        })
        const excess = () => { problem ??= new HttpError(400, '一次只允许上传一个 file 文件，不接受其他字段') }
        parser.once('filesLimit', excess); parser.once('fieldsLimit', excess); parser.once('partsLimit', excess)
        parser.once('error', () => reject(new HttpError(400, '上传中断或 multipart 内容不完整')))
        parser.once('close', resolve)
        req.pipe(parser)
      })
      const result = task ? await task : null
      if (problem) throw problem
      if (!result) throw new HttpError(400, '缺少音频 file 字段')
      return mediaView(result.asset)
    } catch (error) {
      abort.abort()
      if (!parser.destroyed) parser.destroy()
      const result = task ? await task.catch(() => null) : null
      // Never remove an asset reused from an earlier upload when this request is invalid.
      if (result?.created) await this.remove(result.asset.id).catch(() => {})
      throw error
    } finally {
      req.removeListener('aborted', onAbort)
      req.unpipe(parser)
    }
  }

  async remove(id: string) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id } })
    if (!asset) throw new HttpError(404, '音频不存在')
    try {
      const deleted = await prisma.mediaAsset.deleteMany({ where: { id, cards: { none: {} } } })
      if (!deleted.count) throw new HttpError(409, '音频仍被卡片引用，请先解除关联')
    } catch (error) {
      if (error?.code === 'P2003') throw new HttpError(409, '音频仍被卡片引用，请先解除关联')
      throw error
    }
    await fs.promises.unlink(path.join(MEDIA_ROOT, asset.storageKey)).catch(error => { if (error.code !== 'ENOENT') console.error('[media] remove file failed', asset.id, error.code) })
    return true
  }

  async content(id: string, ctx: Context) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id } })
    if (!asset) throw new HttpError(404, '音频不存在')
    const filename = path.join(MEDIA_ROOT, asset.storageKey)
    const stat = await fs.promises.stat(filename).catch(() => null)
    if (!stat?.isFile() || stat.size !== asset.bytes) throw new HttpError(404, '音频文件不存在或不完整')
    ctx.type = asset.mimeType
    ctx.set('Accept-Ranges', 'bytes')
    ctx.set('Cache-Control', 'public, max-age=86400')
    ctx.set('X-Content-Type-Options', 'nosniff')
    ctx.set('ETag', `"${asset.sha256}"`)
    ctx.set('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, ETag')
    ctx.status = 200
    if (ctx.fresh) { ctx.status = 304; ctx.body = null; return ctx }
    const range = ctx.get('Range')
    const useRange = range && ctx.method !== 'HEAD' && (!ctx.get('If-Range') || ctx.get('If-Range') === `"${asset.sha256}"`)
    let start = 0, end = asset.bytes - 1
    if (useRange) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && !match[2])) { ctx.set('Content-Range', `bytes */${asset.bytes}`); ctx.type = 'application/json'; throw new HttpError(416, '不支持的音频范围') }
      if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end) }
      else { const suffix = Number(match[2]); start = Math.max(0, asset.bytes - suffix); if (!suffix) start = asset.bytes }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= asset.bytes) { ctx.set('Content-Range', `bytes */${asset.bytes}`); ctx.type = 'application/json'; throw new HttpError(416, '音频范围超出文件大小') }
      ctx.status = 206
      ctx.set('Content-Range', `bytes ${start}-${end}/${asset.bytes}`)
    }
    ctx.set('Content-Length', String(end - start + 1))
    ctx.body = fs.createReadStream(filename, { start, end })
    return ctx
  }
}
