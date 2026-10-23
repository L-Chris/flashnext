// Read-only by default. Review/undo checks require an explicit disposable preview.
const assert = require('node:assert/strict')
const { chromium } = require('../../../web/node_modules/playwright')
const [base, rawId] = process.argv.slice(2)
const deckId = Number(rawId)
assert(base && deckId > 0, 'Usage: node probability-browser.cjs BASE_URL DECK_ID')
const writes = process.env.FLASHNEXT_ALLOW_TEST_WRITES === '1'
if (writes) {
  const url = new URL(base)
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '19008')
  assert(process.env.PROBABILITY_TEST_DB && !process.env.PROBABILITY_TEST_DB.endsWith('/flashnext.db'), 'Use a disposable DB')
}
async function api(path, body) {
  const response = await fetch(base + '/api' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  assert.equal(response.status, 200, path + ' ' + await response.clone().text())
  return (await response.json()).data
}
;(async () => {
  const decks = await api('/decks'), deck = decks.find(d => d.id === deckId)
  assert.equal(deck.subject, 'probability'); assert.equal(deck.language, 'zh')
  assert.deepEqual(deck.tags.map(t => t.label), ['高中'])
  const settings = await api(`/decks/${deckId}/settings`)
  assert.equal(settings.autoRevealAnswerSeconds, null); assert.equal(settings.showNewCardAnswerImmediately, false)
  const all = await api(`/decks/${deckId}/cards?sort=learningOrder&dir=asc&pageSize=50`)
  assert.equal(all.total, 24)
  assert.deepEqual(all.cards.map(c => c.learningOrder), Array.from({ length: 24 }, (_, i) => (i + 1) * 10))
  const order = new Map(all.cards.map(c => [c.knowledge.key, c.learningOrder]))
  for (const card of all.cards) {
    assert.equal(card.wordId, null); assert.equal(card.word, null)
    assert.equal(card.contentFormat, 'markdown_math')
    assert.deepEqual(card.knowledge.tags.filter(t => t.scheme === 'education-stage').map(t => t.label), ['高中'])
    assert(card.knowledge.prerequisites.every(p => order.get(p.key) < card.learningOrder))
    const rendered = await api('/content/preview', { front: card.front, back: card.back, contentFormat: card.contentFormat })
    assert.equal(rendered.valid, true, card.front)
  }
  const topics = await api(`/decks/${deckId}/topics`)
  assert.deepEqual(topics.map(t => t.cardCount), [4, 5, 3, 3, 4, 5])
  for (const topic of topics) {
    const filtered = await api(`/decks/${deckId}/cards?topic=${topic.key}&pageSize=50`)
    assert.equal(filtered.total, topic.cardCount)
    assert(filtered.cards.every(c => c.knowledge.tags.some(t => t.key === topic.key && t.scheme === 'probability-topic')))
  }
  assert.equal((await api(`/decks/${deckId}/cards?topic=unknown`)).total, 0)
  const queue = await api(`/decks/${deckId}/cards/due`)
  const fresh = all.cards.filter(c => c.state === 0 && c.reps === 0)
  const queuedFresh = queue.cards.filter(c => c.state === 0 && c.reps === 0)
  assert.deepEqual(queuedFresh.map(c => c.id), fresh.slice(0, queuedFresh.length).map(c => c.id))
  assert(queuedFresh.length <= deck.usage.newRemaining)
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const checked = [], errors = []
  try {
    for (const width of [1200, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } })
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(base + '/#/decks')
      const row = page.locator('li').filter({ has: page.getByText('概率论', { exact: true }) })
      await row.getByText('高中', { exact: true }).waitFor()
      await row.click()
      await page.getByRole('columnheader', { name: '知识点' }).waitFor()
      assert.equal(await page.locator('tbody > tr').count(), 24)
      assert((await page.locator('tbody > tr').first().innerText()).includes(all.cards[0].front))
      const selected = width === 1200 ? topics : topics.slice(-1)
      for (const topic of selected) {
        const loaded = page.waitForResponse(r => r.url().includes('/cards?') && new URL(r.url()).searchParams.get('topic') === topic.key)
        await page.getByLabel('筛选主题').selectOption(topic.key); await loaded
        await page.waitForFunction(count => document.querySelectorAll('tbody > tr').length === count, topic.cardCount)
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.close()
      for (const key of ['independent-product', 'combinations', 'total-probability', 'variance', 'binomial', 'hypergeometric', 'normal-properties']) {
        const card = all.cards.find(c => c.knowledge.key.endsWith(':' + key))
        const review = await browser.newPage({ viewport: { width, height: 850 } })
        review.on('pageerror', error => errors.push(error.message))
        await review.route('**/api/**', route => {
          const request = route.request(), url = new URL(request.url())
          assert(request.method() === 'GET' || (request.method() === 'POST' && url.pathname === '/api/content/preview'), 'UI smoke test must not write learning data')
          if (url.pathname === `/api/decks/${deckId}/cards/due`) return route.fulfill({ json: { data: { ...queue, cards: [card] } } })
          return route.continue()
        })
        await review.goto(base + `/#/review/${deckId}`)
        await review.getByRole('button', { name: '显示答案', exact: true }).click()
        await review.getByTestId('card-answer').locator('.katex').first().waitFor()
        assert.equal(await review.locator('.math-error').count(), 0)
        assert.equal(await review.getByTestId('knowledge-labels').getByText('高中', { exact: true }).count(), 1)
        assert(await review.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        checked.push({ key, width }); await review.close()
      }
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
  if (writes) {
    const first = fresh[0], reviewed = await api(`/cards/${first.id}/review`, { rating: 3, durationMs: 1000 })
    assert.equal(reviewed.learningOrder, first.learningOrder); assert.equal(reviewed.knowledge.key, first.knowledge.key)
    const undone = await api(`/cards/${first.id}/undo`, {})
    assert.equal(undone.state, 0); assert.equal(undone.reps, 0)
    assert.deepEqual(undone.knowledge, first.knowledge)
  }
  console.log(JSON.stringify({ status: 'passed', cards: 24, topics: topics.length, checked,
    formulas: true, prerequisiteOrder: true, topicFilters: true, reviewUndo: writes, readOnly: !writes }))
})().catch(error => { console.error(error); process.exit(1) })
