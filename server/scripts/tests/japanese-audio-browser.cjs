// Read-only media/review smoke test. No grading, uploads or setting changes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { chromium } = require('../../../web/node_modules/playwright')
const base = process.argv[2], reportPath = process.argv[3]
if (!base || !reportPath) throw new Error('Usage: node japanese-audio-browser.cjs BASE_URL IMPORT_REPORT')
const manifest = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
async function get(path) {
  const res = await fetch(base + path)
  assert.equal(res.status, 200)
  return (await res.json()).data
}
;(async () => {
  const attached = manifest.records.filter(r => r.cards.some(c => c.status === 'attached'))
  const record = attached.find(r => r.headword === '私') || attached[0]
  assert(record, 'Smoke test needs at least one newly attached card')
  const association = record.cards.find(c => c.status === 'attached')
  assert(association)
  const card = await get('/api/cards/' + association.cardId)
  assert.equal(card.word.language, 'ja'); assert.equal(card.word.reading, record.reading)
  assert.equal(card.presentation.audioAutoplay, true, 'Existing deck setting must enable autoplay')
  const audio = card.media.find(m => m.mediaId === association.mediaId)
  assert(audio); assert.equal(audio.side, 'back'); assert.equal(audio.mimeType, 'audio/mpeg')
  const res = await fetch(base + audio.url)
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /audio\/mpeg/)
  const bytes = Buffer.from(await res.arrayBuffer())
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), audio.playback?.sha256 || record.sha256)
  const ranged = await fetch(base + audio.url, { headers: { Range: 'bytes=0-127' } })
  assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 128)
  const originalQueue = await get(`/api/decks/${card.deckId}/cards/due`)
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    // Select the actual imported card without scoring or changing the DB queue.
    await page.route(`**/api/decks/${card.deckId}/cards/due`, route => route.fulfill({ json: { data: {
      ...originalQueue, cards: [{ ...card, presentation: { ...card.presentation, answerRevealAfterMs: null } }],
    } } }))
    await page.goto(`${base}/#/deck/${card.deckId}`)
    await page.getByRole('button', { name: '复习', exact: true }).click()
    await page.getByTestId('review-card').waitFor()
    assert.equal(await page.locator('audio[data-card-audio]').count(), 0, 'Front must not expose back audio')
    await page.getByRole('button', { name: '显示答案', exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('audio[data-card-audio]')].some(a => a.currentTime > .1 && !a.error))
    const answer = await page.getByTestId('card-answer').innerText()
    assert(answer.includes(record.reading))
    await page.setViewportSize({ width: 390, height: 844 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    assert.deepEqual(errors, [])
    const after = await get('/api/cards/' + card.id)
    for (const k of ['stability', 'difficulty', 'reps', 'lapses', 'state', 'due', 'lastReview']) assert.equal(after[k], card[k])
    console.log('PASS imported MP3 hash/MIME/ranges, Japanese reading, back-only autoplay, mobile width and unchanged learning state')
  } finally { await browser.close() }
})().catch(e => { console.error(e); process.exit(1) })
