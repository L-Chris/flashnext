// Run after prisma db push. Existing words are English; preserve every ID and value.
const { PrismaClient } = require('@prisma/client')
async function migrateWordLanguages(prisma) {
  return prisma.$transaction(async tx => {
    const words = await tx.word.findMany({ where: { language: 'en', lexicalKey: null }, select: { id: true, headword: true } })
    for (const w of words) await tx.word.update({ where: { id: w.id }, data: { lexicalKey: `en:word:${w.headword}` } })
    return words.length
  }, { timeout: 60000 })
}
if (require.main === module) {
  const prisma = new PrismaClient()
  migrateWordLanguages(prisma).then(n => console.log(`English lexical keys initialized: ${n}`)).finally(() => prisma.$disconnect()).catch(e => { console.error(e); process.exitCode = 1 })
}
module.exports = { migrateWordLanguages }
