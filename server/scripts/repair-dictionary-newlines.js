const fs = require('fs')
const { PrismaClient } = require('@prisma/client')
const { normalizeDictionaryNewlines } = require('./lib/dictionary-text')

const rawBack = (phonetic, translation) => (phonetic ? `/${phonetic}/\n` : '') + translation

function planRepair(words) {
  const wordsToUpdate = [], cardsToUpdate = [], entitiesToUpdate = [], protectedCards = []
  for (const w of words) {
    const translation = normalizeDictionaryNewlines(w.translation)
    if (translation === w.translation) continue
    wordsToUpdate.push({ id: w.id, headword: w.headword, before: w.translation, after: translation })
    const originals = new Set([w.phonetic, w.phoneticLegacy].filter(p => p != null)
      .flatMap(p => [rawBack(p, w.translation), rawBack(p, translation)]))
    for (const card of w.cards || []) {
      if (card.front !== w.headword || !originals.has(card.back)) {
        protectedCards.push(card.id)
        continue
      }
      const back = normalizeDictionaryNewlines(card.back)
      if (back !== card.back) cardsToUpdate.push({ id: card.id, before: card.back, after: back })
    }
    if (w.knowledgeEntity?.summary === w.translation) {
      entitiesToUpdate.push({ id: w.knowledgeEntity.id, before: w.translation, after: translation })
    }
  }
  return { words: wordsToUpdate, cards: cardsToUpdate, entities: entitiesToUpdate, protectedCards }
}

async function repair(prisma, { apply = false } = {}) {
  return prisma.$transaction(async tx => {
    const words = await tx.word.findMany({
      where: { language: 'en', OR: ['\\n', '\\r', '\r'].map(value => ({ translation: { contains: value } })) },
      include: { cards: true, knowledgeEntity: true },
    })
    const plan = planRepair(words)
    if (apply) {
      // Include the before value in each update so a stale snapshot cannot overwrite edits.
      for (const [table, field, rows] of [['word', 'translation', plan.words], ['card', 'back', plan.cards], ['knowledgeEntity', 'summary', plan.entities]]) {
        for (const row of rows) {
          const updated = await tx[table].updateMany({ where: { id: row.id, [field]: row.before }, data: { [field]: row.after } })
          if (updated.count !== 1) throw new Error(`Concurrent edit of ${table} ${row.id}; transaction rolled back`)
        }
      }
    }
    return plan
  }, { timeout: 60000 })
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set an explicit DATABASE_URL; default mode is dry-run')
  const prisma = new PrismaClient()
  try {
    const apply = process.argv.includes('--apply')
    const plan = await repair(prisma, { apply })
    const i = process.argv.indexOf('--report')
    if (i >= 0) {
      if (!process.argv[i + 1]) throw new Error('--report needs a file path')
      fs.writeFileSync(process.argv[i + 1], JSON.stringify({ apply, ...plan }, null, 2))
    }
    console.log(JSON.stringify({ apply, words: plan.words.length, cards: plan.cards.length, summaries: plan.entities.length, protectedCards: plan.protectedCards.length }))
  } finally { await prisma.$disconnect() }
}
module.exports = { planRepair, repair }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
