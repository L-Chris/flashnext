const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const http = require('node:http')
const esbuild = require('../../node_modules/esbuild')
const Koa = require('../../node_modules/koa')
require('reflect-metadata')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flashnext-playback-test-'))
process.env.DATABASE_URL = `file:${root}/test.db`
process.env.FLASHNEXT_MEDIA_DIR = root
const sql = execFileSync(process.execPath, [path.resolve(__dirname, '../../node_modules/prisma/build/index.js'),
  'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.resolve(__dirname, '../../prisma/schema.prisma'), '--script'], { encoding: 'utf8' })
execFileSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]);c.executescript(sys.stdin.read());c.close()', root + '/test.db'], { input: sql })
const outfile = path.resolve(__dirname, '../../node_modules/.cache/playback-tests.cjs')
esbuild.buildSync({ stdin: { contents: `export {MediaService, mediaView} from './app/modules/media/application/media.service';export {prisma} from './app/shared/prisma';`, resolveDir: path.resolve(__dirname, '../..') },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile, tsconfig: path.resolve(__dirname, '../../tsconfig.json') })
const { MediaService, mediaView, prisma } = require(outfile)
const service = new MediaService()
const original = Buffer.from('original-data-'.repeat(40)), processed = Buffer.from('processed-data-'.repeat(50))
let asset, other, playback, link, server, base
test.before(async () => {
  const deck = await prisma.deck.create({ data: { name: 'fixture' } })
  const card = await prisma.card.create({ data: { deckId: deck.id, front: 'fixture', back: 'fixture' } })
  asset = await prisma.mediaAsset.create({ data: { storageKey: 'raw.mp3', sha256: 'a'.repeat(64), bytes: original.length, mimeType: 'audio/mpeg', originalName: 'word.mp3' } })
  other = await prisma.mediaAsset.create({ data: { storageKey: 'other.mp3', sha256: 'c'.repeat(64), bytes: original.length, mimeType: 'audio/mpeg', originalName: 'other.mp3' } })
  playback = await prisma.mediaPlayback.create({ data: { mediaId: asset.id, sourceSha256: asset.sha256, profile: 'study-speech-loudness-v1', storageKey: '.playback/fixed.mp3', sha256: 'b'.repeat(64), bytes: processed.length, mimeType: 'audio/mpeg', metrics: '{}' } })
  link = await prisma.cardMedia.create({ data: { cardId: card.id, mediaId: asset.id, side: 'back' } })
  fs.mkdirSync(root + '/.playback');fs.writeFileSync(root + '/raw.mp3', original);fs.writeFileSync(root + '/.playback/fixed.mp3', processed)
  const app = new Koa(); app.on('error', () => {})
  app.use(async ctx => {
    try { await service.content(ctx.path.split('/')[3], ctx) }
    catch (e) { ctx.status = e.httpCode || 500;ctx.body = {error: e.message} }
  })
  server = app.listen(0, '127.0.0.1');await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}/api/media/${asset.id}/content`
})
test.after(async () => { await new Promise(resolve => server.close(resolve));await prisma.$disconnect();fs.rmSync(root, { recursive: true, force: true }) })
test('card media uses a versioned playback URL while original identity is stable', () => {
  const dto = mediaView({ ...asset, playbacks: [playback] })
  assert.equal(dto.id, asset.id);assert.equal(dto.bytes, processed.length)
  assert.equal(dto.url, `/api/media/${asset.id}/content?playback=${playback.id}`)
  assert.equal(dto.playback.sha256, playback.sha256)
  assert.equal(mediaView({ ...asset, playbacks: [{ ...playback, sourceSha256: 'changed' }] }).url, `/api/media/${asset.id}/content`)
})
test('original and processed HTTP bytes, ranges, HEAD and conditional caching remain independent', async () => {
  let response = await fetch(base);assert.deepEqual(Buffer.from(await response.arrayBuffer()), original)
  response = await fetch(base + '?playback=' + playback.id)
  assert.equal(response.status, 200);assert.match(response.headers.get('cache-control'), /immutable/)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), processed)
  response = await fetch(base + '?playback=' + playback.id, { method: 'HEAD' })
  assert.equal(response.status, 200);assert.equal(+response.headers.get('content-length'), processed.length)
  response = await fetch(base + '?playback=' + playback.id, { headers: { Range: 'bytes=0-127' } })
  assert.equal(response.status, 206);assert.deepEqual(Buffer.from(await response.arrayBuffer()), processed.subarray(0, 128))
  response = await fetch(base + '?playback=' + playback.id, { headers: { Range: 'bytes=0-127', 'If-Range': `"${asset.sha256}"` } })
  assert.equal(response.status, 200);assert.equal((await response.arrayBuffer()).byteLength, processed.length)
  // fetch adds Cache-Control: no-cache for conditional requests; use raw HTTP here.
  const conditionalStatus = await new Promise((resolve, reject) => {
    http.get(base + '?playback=' + playback.id, { headers: { 'If-None-Match': `"${playback.sha256}"` } }, response => {
      response.resume();response.on('end', () => resolve(response.statusCode))
    }).on('error', reject)
  })
  assert.equal(conditionalStatus, 304)
  assert.equal((await fetch(base + '?playback=missing')).status, 404)
  assert.equal((await fetch(base.replace(asset.id, other.id) + '?playback=' + playback.id)).status, 404)
})
test('deleting a referenced original is refused; deleting an unused asset removes its derivative', async () => {
  await assert.rejects(service.remove(asset.id), e => e.httpCode === 409)
  assert(fs.existsSync(root + '/raw.mp3'));assert(fs.existsSync(root + '/.playback/fixed.mp3'))
  await prisma.cardMedia.delete({ where: { id: link.id } });await service.remove(asset.id)
  assert.equal(await prisma.mediaPlayback.count({ where: { mediaId: asset.id } }), 0)
  assert(!fs.existsSync(root + '/raw.mp3'));assert(!fs.existsSync(root + '/.playback/fixed.mp3'))
})
