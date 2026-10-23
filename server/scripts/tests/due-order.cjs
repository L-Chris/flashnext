const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const esbuild = require('../../node_modules/esbuild')
require('reflect-metadata')
// All collaborators are fakes; a Prisma connection is never opened.
process.env.DATABASE_URL = 'file:./unused-due-order-test.db'
const root = path.resolve(__dirname, '../..')
const outfile = path.join(root, 'node_modules/.cache/due-order.cjs')
esbuild.buildSync({
  stdin: { contents: `export { DueService } from './app/modules/cards/application/due.service'; export { scheduleReview } from './app/modules/cards/application/fsrs.scheduler';`, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile,
  tsconfig: path.join(root, 'tsconfig.json'),
})
const { DueService, scheduleReview } = require(outfile)
const now = new Date('2026-10-21T02:00:00Z')
const clock = { timezone: 'Asia/Shanghai', rolloverHour: 4 }
const card = (id, state, minutes = 0) => ({
  id, deckId: 1, state, due: new Date(+now + minutes * 60000),
  createdAt: now, lastReview: null, interval: state === 2 ? 3 : 0,
  stability: 1, difficulty: 0, learningSteps: 0, reps: 0, lapses: 0,
})
async function service(cards, limits = {}) {
  const { default_w } = await import('ts-fsrs')
  return new DueService(
    { listDueCandidates: async () => cards, listByIds: async ids => cards.filter(c => ids.includes(c.id)).reverse() },
    { listLogsBetween: async () => [] },
    { getCurrentW: async () => [...default_w] },
    { get: async () => ({ deckId: 1, newPerDay: 20, reviewPerDay: 100, ...clock, ...limits }) },
    { cards: async cards => cards },
  )
}

test('a future learning card never jumps ahead of review and new cards', async () => {
  const queue = await (await service([card(1, 1, 10), card(2, 2), card(3, 0)])).queue(1, now)
  assert.deepEqual(queue.cards.map(c => c.id), [2, 3, 1])
})

test('due learning remains first; learn-ahead remains ordered by due time', async () => {
  const queue = await (await service([card(5, 3, 10), card(4, 1, 1), card(3, 0), card(2, 2), card(1, 1, -1)])).queue(1, now)
  assert.deepEqual(queue.cards.map(c => c.id), [1, 2, 3, 4, 5])
  assert.equal(queue.counts.intraday, 3)
  assert.equal(queue.counts.queued, 5)
})

test('after the actual delay passes the learning card takes priority again', async () => {
  const fixture = await service([card(1, 1, 1), card(2, 0)])
  assert.deepEqual((await fixture.queue(1, now)).cards.map(c => c.id), [2, 1])
  assert.deepEqual((await fixture.queue(1, new Date(+now + 60000))).cards.map(c => c.id), [1, 2])
})

test('limits still apply only to review/new cards, not ongoing learning', async () => {
  const fixture = await service([card(1, 1, 5), card(2, 2), card(3, 0)], { newPerDay: 0, reviewPerDay: 0 })
  const queue = await fixture.queue(1, now)
  assert.deepEqual(queue.cards.map(c => c.id), [1])
  assert.equal(queue.counts.hiddenByLimit, 2)
  assert.equal((await fixture.summary(1, now)).dueCount, 1)
})

test('learning ahead is still available when it is the only remaining work', async () => {
  const fixture = await service([card(1, 1, 10)])
  assert.deepEqual((await fixture.queue(1, now)).cards.map(c => c.id), [1])
})

test('authored learning order precedes IDs and is applied before the daily new-card limit', async () => {
  const fixture = await service([
    { ...card(1, 0), learningOrder: 30 }, { ...card(50, 0), learningOrder: 10 },
    { ...card(2, 0), learningOrder: 20 }, card(3, 0),
  ], { newPerDay: 2 })
  const queue = await fixture.queue(1, now)
  assert.deepEqual(queue.cards.map(c => c.id), [50, 2])
  assert.equal(queue.counts.fresh, 4)
  assert.equal(queue.counts.hiddenByLimit, 2)
  assert.equal((await fixture.summary(1, now)).dueCount, 2)
})

test('unordered cards keep ID order; learning order never overrides review priority', async () => {
  const review = { ...card(20, 2), learningOrder: 999 }
  const queue = await (await service([card(3, 0), review, { ...card(50, 0), learningOrder: 10 }, card(1, 0)])).queue(1, now)
  assert.deepEqual(queue.cards.map(c => c.id), [20, 50, 1, 3])
})

test('non-Easy first ratings schedule a delay instead of an immediate repeat', async () => {
  const { default_w } = await import('ts-fsrs')
  const fresh = { ...card(1, 0), stability: 0 }
  for (const rating of [1, 2, 3]) {
    const next = await scheduleReview(fresh, rating, [...default_w], now, clock)
    assert(next.due > now)
    assert.equal(next.scheduled_days, 0)
    const rated = { ...fresh, state: next.state, due: next.due, interval: next.scheduled_days }
    const queue = await (await service([rated, card(2, 0)])).queue(1, now)
    assert.equal(queue.cards[0].id, 2, `rating ${rating} must advance to another card`)
  }
  const easy = await scheduleReview(fresh, 4, [...default_w], now, clock)
  assert(easy.scheduled_days >= 1)
})
