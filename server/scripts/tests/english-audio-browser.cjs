// Read-only smoke test: imported files, HTTP playback and real English review UI.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { chromium } = require('../../../web/node_modules/playwright')
const [base, reportPath] = process.argv.slice(2)
if (!base || !reportPath) throw Error('Usage: node english-audio-browser.cjs BASE_URL IMPORT_REPORT')
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
async function get(path) {
  const response = await fetch(base + path)
  assert.equal(response.status, 200)
  return (await response.json()).data
}
;(async () => {
  const entries = report.records.filter(r => r.cards.some(c => c.status === 'attached'))
  const selected = [...new Set([entries[0], entries[Math.min(25, entries.length - 1)]])]
  const models = new Set()
  for (const entry of entries) {
    const model = report.evidence[String(entry.wordId)].model
    if (!models.has(model)) {
      models.add(model)
      if (!selected.includes(entry)) selected.push(entry)
    }
  }
  assert(selected[0], 'Need at least one newly attached recording')
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] })
  const checked = []
  try {
    for (const record of selected) {
      const target = record.cards.find(c => c.status === 'attached')
      const card = await get('/api/cards/' + target.cardId)
      assert.equal(card.word.language, 'en'); assert.equal(card.front, record.headword)
      assert.equal(card.presentation.audioAutoplay, true)
      const audio = card.media.find(m => m.mediaId === target.mediaId)
      assert(audio && audio.side === 'back'); assert.equal(audio.mimeType, 'audio/mpeg')
      const response = await fetch(base + audio.url)
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /audio\/mpeg/)
      const bytes = Buffer.from(await response.arrayBuffer())
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), record.sha256)
      const range = await fetch(base + audio.url, { headers: { Range: 'bytes=0-127' } })
      assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 128)
      for (const width of [1200, 390]) {
        const page = await browser.newPage({ viewport: { width, height: 850 } })
        const errors = []
        page.on('pageerror', e => errors.push(e.message))
        const queue = await get(`/api/decks/${card.deckId}/cards/due`)
        await page.route(url => url.pathname.startsWith('/api/'), route => {
          assert.equal(route.request().method(), 'GET', 'Browser check must never write data')
          if (new URL(route.request().url()).pathname !== `/api/decks/${card.deckId}/cards/due`) return route.continue()
          return route.fulfill({ json: { data: { ...queue, cards: [{ ...card,
            presentation: { ...card.presentation, answerRevealAfterMs: null } }] } } })
        })
        await page.goto(`${base}/#/review/${card.deckId}`)
        await page.getByTestId('review-card').waitFor()
        assert.equal(await page.locator('audio[data-card-audio]').count(), 0)
        await page.getByRole('button', { name: '显示答案', exact: true }).click()
        await page.waitForFunction(() => [...document.querySelectorAll('audio[data-card-audio]')].some(a => a.currentTime > .1 && !a.error))
        assert((await page.getByTestId('card-answer').innerText()).includes(card.word.phonetic))
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        assert.deepEqual(errors, [])
        checked.push({ word: record.headword, width, model: report.evidence[String(record.wordId)].model, backOnlyAutoplay: true })
        await page.close()
      }
      const after = await get('/api/cards/' + card.id)
      for (const key of ['stability','difficulty','reps','lapses','state','due','lastReview']) assert.equal(after[key], card[key])
    }
    console.log(JSON.stringify({ status: 'passed', checked, sha256: true, mime: true, ranges: true, readOnly: true }))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
