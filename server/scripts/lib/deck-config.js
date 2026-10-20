const { TZ_NAME, ROLLOVER_HOUR } = require('../../app/shared/day-boundary')

async function ensureDeckConfig(prisma, deckId, legacy = false) {
  const deck = await prisma.deck.findUnique({ where: { id: deckId } })
  if (!deck) throw new Error('牌组不存在')
  const defaults = await prisma.appSetting.findUnique({ where: { id: 1 } })
  const settings = await prisma.deckSetting.upsert({
    where: { deckId }, update: {},
    create: { deckId, newPerDay: defaults?.newPerDay ?? Number(process.env.FLASHNEXT_NEW_PER_DAY || 20),
      reviewPerDay: defaults?.reviewPerDay ?? Number(process.env.FLASHNEXT_REVIEWS_PER_DAY || 200), timezone: TZ_NAME, rolloverHour: ROLLOVER_HOUR },
  })
  const old = legacy && deck.language === 'en' ? await prisma.fsrsParam.findUnique({ where: { id: 1 } }) : null
  const { default_w } = await import('ts-fsrs')
  const params = await prisma.deckFsrsParam.upsert({
    where: { deckId }, update: {},
    create: { deckId, w: old?.w && JSON.parse(old.w).length ? old.w : JSON.stringify(default_w),
      source: old?.source ?? 'default', updatedAt: old?.updatedAt ?? new Date(),
      revlogMigratedAt: old?.revlogMigratedAt ?? (old ? null : new Date()) },
  })
  return { settings, params }
}
module.exports = { ensureDeckConfig }
