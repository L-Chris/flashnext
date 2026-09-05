const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const FILES = [
  { file: 'cet4.txt', level: 4, label: 'CET-4' },
  { file: 'cet6.txt', level: 6, label: 'CET-6' },
]

const WORD_RE = /^[A-Za-z][A-Za-z'\-.]*$/

const envPath = path.join(__dirname, '..', '.env')
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const prisma = new PrismaClient()

const parseWords = file => {
  const words = new Set()
  for (const raw of fs.readFileSync(path.join(__dirname, 'data', file), 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const token = line.split(/\s+/)[0]
    if (!WORD_RE.test(token)) continue
    words.add(token.toLowerCase())
  }
  return [...words]
}

const main = async () => {
  const allWords = await prisma.word.findMany({ select: { id: true, headword: true } })
  const wordByKey = new Map(allWords.map(w => [w.headword.toLowerCase(), w]))

  const existing = await prisma.wordTag.findMany({
    where: { scheme: 'cet' },
    select: { wordId: true, level: true },
  })
  const have = new Set(existing.map(t => `${t.wordId}:${t.level}`))

  for (const { file, level, label } of FILES) {
    const list = parseWords(file)
    const rows = []
    let unmatched = 0
    const unmatchedSample = []
    for (const key of list) {
      const word = wordByKey.get(key)
      if (!word) {
        unmatched++
        if (unmatchedSample.length < 10) unmatchedSample.push(key)
        continue
      }
      if (have.has(`${word.id}:${level}`)) continue
      rows.push({ wordId: word.id, scheme: 'cet', level, label })
    }
    for (let i = 0; i < rows.length; i += 1000) {
      await prisma.wordTag.createMany({ data: rows.slice(i, i + 1000) })
    }
    console.log(
      `${label}: list=${list.length} tagged=${rows.length} not_in_library=${unmatched} sample=${unmatchedSample.join(', ')}`,
    )
  }

  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
