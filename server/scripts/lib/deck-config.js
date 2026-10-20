const { TZ_NAME, ROLLOVER_HOUR } = require('../../app/shared/day-boundary')

async function ensureGlobalSettings(prisma) {
  let row = await prisma.appSetting.findUnique({ where: { id: 1 } })
  if (!row) row = await prisma.appSetting.upsert({ where: { id: 1 }, update: {},
    create: { id: 1, newPerDay: Number(process.env.FLASHNEXT_NEW_PER_DAY || 20),
      reviewPerDay: Number(process.env.FLASHNEXT_REVIEWS_PER_DAY || 200), timezone: TZ_NAME } })
  if (row.timezone === null) {
    const clocks = await prisma.deckSetting.findMany({ select: { timezone: true }, distinct: ['timezone'], take: 2 })
    const timezone = clocks.length === 1 ? clocks[0].timezone : TZ_NAME
    await prisma.appSetting.updateMany({ where: { id: 1, timezone: null }, data: { timezone } })
    row = await prisma.appSetting.findUniqueOrThrow({ where: { id: 1 } })
  }
  return row
}

async function ensureDeckConfig(prisma, deckId, legacy = false) {
  if (typeof prisma.$transaction === 'function') return prisma.$transaction(tx => ensureDeckConfig(tx, deckId, legacy))
  const deck = await prisma.deck.findUnique({ where: { id: deckId } })
  if (!deck) throw new Error('牌组不存在')
  const defaults = await ensureGlobalSettings(prisma)
  const settings = await prisma.deckSetting.upsert({
    where: { deckId }, update: {},
    create: { deckId, newPerDay: defaults?.newPerDay ?? Number(process.env.FLASHNEXT_NEW_PER_DAY || 20),
      reviewPerDay: defaults?.reviewPerDay ?? Number(process.env.FLASHNEXT_REVIEWS_PER_DAY || 200), timezone: defaults.timezone || TZ_NAME, rolloverHour: ROLLOVER_HOUR },
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
module.exports = { ensureDeckConfig, ensureGlobalSettings }
