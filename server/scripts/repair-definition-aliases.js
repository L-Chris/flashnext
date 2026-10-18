const fs = require('fs')
const { PrismaClient } = require('@prisma/client')
const { overrides, dictionaryTranslation } = require('./lib/definition-overrides')
const { dictionaryCardBack } = require('./lib/dictionary-text')

function planRepair(words) {
  const plan = { words: [], cards: [], entities: [], protectedCards: [] }
  for (const word of words) {
    const translation = dictionaryTranslation(word.headword, word.translation)
    if (translation === word.translation) continue
    const pos = overrides[word.headword]?.pos || word.pos
    plan.words.push({ id: word.id, headword: word.headword, before: word.translation, after: translation, ...(pos !== word.pos ? { posBefore: word.pos, posAfter: pos } : {}) })
    const original = dictionaryCardBack(word.phonetic, word.translation)
    for (const card of word.cards || []) {
      if (card.front !== word.headword || card.back !== original) { plan.protectedCards.push(card.id); continue }
      plan.cards.push({ id: card.id, before: card.back, after: dictionaryCardBack(word.phonetic, translation) })
    }
    if (word.knowledgeEntity?.summary === word.translation) {
      const key = overrides[word.headword]?.canonicalKey
      plan.entities.push({ id: word.knowledgeEntity.id, before: word.translation, after: translation,
        ...(key && key !== word.knowledgeEntity.canonicalKey ? { keyBefore: word.knowledgeEntity.canonicalKey, keyAfter: key } : {}) })
    }
  }
  return plan
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set an explicit DATABASE_URL')
  const apply = process.argv.includes('--apply'), index = process.argv.indexOf('--report')
  const report = index >= 0 ? process.argv[index + 1] : null
  if (apply && !report) throw new Error('--apply requires --report to save original values before updating')
  const prisma = new PrismaClient()
  try {
    const plan = await prisma.$transaction(async tx => {
      const words = await tx.word.findMany({ where: { headword: { in: Object.keys(overrides) } }, include: { cards: true, knowledgeEntity: true } })
      const plan = planRepair(words)
      if (report) fs.writeFileSync(report, JSON.stringify({ apply: false, ...plan }, null, 2))
      if (apply) {
        for (const [table, field, rows] of [['word', 'translation', plan.words], ['card', 'back', plan.cards], ['knowledgeEntity', 'summary', plan.entities]]) {
          for (const r of rows) {
            const position = table === 'word' && r.posAfter !== undefined
            const entityKey = table === 'knowledgeEntity' && r.keyAfter !== undefined
            const changed = await tx[table].updateMany({ where: { id: r.id, [field]: r.before, ...(position ? { pos: r.posBefore } : {}), ...(entityKey ? { canonicalKey: r.keyBefore } : {}) }, data: { [field]: r.after, ...(position ? { pos: r.posAfter } : {}), ...(entityKey ? { canonicalKey: r.keyAfter } : {}) } })
            if (changed.count !== 1) throw new Error('Concurrent edit; transaction rolled back')
          }
        }
      }
      return plan
    })
    if (report) fs.writeFileSync(report, JSON.stringify({ apply, ...plan }, null, 2))
    console.log(JSON.stringify({ apply, words: plan.words.length, cards: plan.cards.length, summaries: plan.entities.length, protectedCards: plan.protectedCards.length }))
  } finally { await prisma.$disconnect() }
}
module.exports = { planRepair }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
