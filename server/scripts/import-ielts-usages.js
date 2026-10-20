const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')
const dataset = require('./resources/ielts-repeated-words.json')

// Chapter occurrences belong to an existing word, not to new cards or schedules.
async function importIeltsUsages(prisma, { dryRun = false } = {}) {
  const words = await prisma.word.findMany({ where: { language: 'en' }, select: { id: true, headword: true } })
  const byKey = new Map()
  for (const word of words) {
    const key = word.headword.toLowerCase()
    const matches = byKey.get(key) || []
    matches.push(word)
    byKey.set(key, matches)
  }
  const keys = new Set()
  const counts = new Map()
  const rows = dataset.entries.map(entry => {
    const matches = byKey.get(entry.headword.toLowerCase()) || []
    if (matches.length !== 1) throw new Error(`Expected exactly one word for ${entry.headword}, found ${matches.length}`)
    if (!Number.isInteger(entry.sourceOrder) || keys.has(entry.sourceOrder)) throw new Error('Invalid/duplicate sourceOrder')
    if (![entry.chapter, entry.displayWord, entry.pos, entry.meaning].every(s => typeof s === 'string' && s.trim())) {
      throw new Error(`Incomplete usage for ${entry.headword}`)
    }
    keys.add(entry.sourceOrder)
    counts.set(entry.headword, (counts.get(entry.headword) || 0) + 1)
    const { headword, ...data } = entry
    return { ...data, wordId: matches[0].id, source: dataset.source, sourceUrl: dataset.sourceUrl }
  })
  if (counts.size !== 43 || rows.length !== 86 || [...counts.values()].some(n => n !== 2)) {
    throw new Error('Expected 43 repeated words with 86 chapter occurrences')
  }
  if (!dryRun) {
    await prisma.$transaction(rows.map(data => prisma.ieltsUsage.upsert({
      where: { source_sourceOrder: { source: data.source, sourceOrder: data.sourceOrder } },
      update: { ...data, phonetic: undefined }, // Pronunciation updates go through the reviewed pipeline.
      create: data,
    })))
  }
  return { words: counts.size, occurrences: rows.length, dryRun }
}

async function main() {
  const envPath = path.join(__dirname, '..', '.env')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  const prisma = new PrismaClient()
  try {
    console.log(JSON.stringify(await importIeltsUsages(prisma, { dryRun: process.argv.includes('--dry-run') })))
  } finally {
    await prisma.$disconnect()
  }
}

module.exports = { importIeltsUsages }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
