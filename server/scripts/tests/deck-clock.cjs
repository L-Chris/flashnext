const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const esbuild = require('../../node_modules/esbuild')
const clock = require('../../app/shared/day-boundary')
const sh = { timezone: 'Asia/Shanghai', rolloverHour: 4 }
const tokyo = { timezone: 'Asia/Tokyo', rolloverHour: 6 }
const ms = value => new Date(value).getTime()
const iso = value => new Date(value).toISOString()
test('deck cutoffs are independent and default Shanghai behavior is preserved', () => {
  const now = ms('2026-10-19T20:30:00Z')
  assert.equal(iso(clock.cutStartOf(now, sh)), '2026-10-19T20:00:00.000Z')
  assert.equal(iso(clock.cutStartOf(now, tokyo)), '2026-10-18T21:00:00.000Z')
  assert.equal(clock.dayIndexOf(now), clock.dayIndexOf(now, sh))
  assert.equal(clock.elapsedDaysBetween(ms('2026-10-19T19:59:59Z'), now, sh), 1)
  assert.equal(clock.elapsedDaysBetween(ms('2026-10-19T19:59:59Z'), now, tokyo), 0)
  clock.dueWindowOf(now, tokyo)
  assert.equal(iso(clock.nextCutStartOf(now)), '2026-10-20T20:00:00.000Z')
})
test('DST days have 23/25 hours without changing elapsed calendar days', () => {
  const ny = { timezone: 'America/New_York', rolloverHour: 4 }
  for (const [start, end, hours] of [['2026-03-07T09:00:00Z','2026-03-08T08:00:00Z',23],['2026-10-31T08:00:00Z','2026-11-01T09:00:00Z',25]]) {
    assert.equal(clock.nextCutStartOf(ms(start),ny),ms(end))
    assert.equal((ms(end)-ms(start))/3600000,hours)
    assert.equal(clock.elapsedDaysBetween(ms(start),ms(end),ny),1)
  }
})
test('DST folded cutoff never resets the same learning day twice', () => {
  const ny = { timezone: 'America/New_York', rolloverHour: 1 }
  const first = ms('2026-11-01T05:30:00Z'), second = ms('2026-11-01T06:00:00Z')
  assert.equal(clock.dayIndexOf(first,ny),clock.dayIndexOf(second,ny))
  assert.equal(clock.cutStartOf(first,ny),clock.cutStartOf(second,ny))
})
test('scheduler applies the selected deck clock and weights on alternating calls', async () => {
  const outfile = path.resolve(__dirname,'../../node_modules/.cache/deck-clock-scheduler.cjs')
  fs.mkdirSync(path.dirname(outfile), {recursive:true})
  esbuild.buildSync({entryPoints:[path.resolve(__dirname,'../../app/modules/cards/application/fsrs.scheduler.ts')], bundle:true,platform:'node',format:'cjs',packages:'external',outfile,tsconfig:path.resolve(__dirname,'../../tsconfig.json')})
  const {scheduleReview} = require(outfile)
  const {default_w} = await import('ts-fsrs')
  const card = {id:87654,due:new Date(),lastReview:null,state:0,reps:0,lapses:0,stability:0,difficulty:0,learningSteps:0,interval:0}
  const now = new Date('2026-10-19T20:30:00Z')
  const a = await scheduleReview(card,4,[...default_w],now,sh)
  const b = await scheduleReview(card,4,[...default_w],now,tokyo)
  assert.equal(a.scheduled_days,b.scheduled_days)
  assert.equal(a.due.getTime(),clock.cutStartOfIndex(clock.dayIndexOf(now,sh)+a.scheduled_days,sh))
  assert.equal(b.due.getTime(),clock.cutStartOfIndex(clock.dayIndexOf(now,tokyo)+b.scheduled_days,tokyo))
  assert.notEqual(a.due.getTime(),b.due.getTime())
  const weights=[...default_w];weights[3]=80
  const changed = await scheduleReview(card,4,weights,now,sh)
  assert.notEqual(changed.stability,a.stability)
  const again = await scheduleReview(card,4,[...default_w],now,sh)
  assert.equal(again.stability,a.stability)
  assert.equal(again.due.getTime(),a.due.getTime())
})
