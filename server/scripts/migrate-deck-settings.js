const { PrismaClient } = require('@prisma/client')
const { ensureDeckConfig, ensureGlobalSettings } = require('./lib/deck-config')
async function migrateDeckSettings(prisma) {
  const decks = await prisma.deck.findMany({ select: { id: true } })
  for (const deck of decks) await ensureDeckConfig(prisma, deck.id, true)
  await prisma.$transaction(async tx => {
    const global = await ensureGlobalSettings(tx)
    await tx.deckSetting.updateMany({ where: { timezone: { not: global.timezone } },
      data: { timezone: global.timezone, version: { increment: 1 } } })
  })
  return decks.length
}
if (require.main === module) {
  const prisma = new PrismaClient()
  migrateDeckSettings(prisma).then(n => console.log(`Deck settings initialized: ${n}`)).finally(() => prisma.$disconnect()).catch(e => { console.error(e); process.exitCode = 1 })
}
module.exports = { migrateDeckSettings }
