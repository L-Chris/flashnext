const fs = require('fs')
const { PrismaClient } = require('@prisma/client')

for (const l of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = l.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const prisma = new PrismaClient()

const PURE_RE = /^[\p{L}]+(?:[-'’][\p{L}]+)*$/u

const decodeEntities = s =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')

const normalize = raw => {
  let s = decodeEntities(raw)
  s = s.replace(/(?:^\[[^\]]*\])+/, '')
  s = s.replace(/\([^)]*\)/g, '')
  if (s.includes('/')) s = s.split('/')[0]
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^[.\s]+|[.\s]+$/g, '')
  return s
}

const main = async () => {
  const words = await prisma.word.findMany({
    select: { id: true, headword: true },
    orderBy: { id: 'asc' },
  })
  const byLower = new Map(words.map(w => [w.headword.toLowerCase(), w]))

  const rename = []
  const remove = []

  for (const w of words) {
    if (PURE_RE.test(w.headword)) continue
    const norm = normalize(w.headword)
    if (PURE_RE.test(norm)) {
      const clash = byLower.get(norm.toLowerCase())
      if (!clash) {
        rename.push({ id: w.id, from: w.headword, to: norm })
        byLower.set(norm.toLowerCase(), w)
        byLower.delete(w.headword.toLowerCase())
      } else {
        remove.push({ id: w.id, headword: w.headword, reason: `dup-of:${clash.headword}` })
      }
    } else {
      remove.push({ id: w.id, headword: w.headword, reason: 'impure' })
    }
  }

  console.log(`rename: ${rename.length}, remove: ${remove.length}`)
  console.log('rename samples:', rename.slice(0, 10).map(r => `${r.from} -> ${r.to}`).join(' | '))
  console.log('remove samples:', remove.slice(0, 10).map(r => r.headword.slice(0, 40)).join(' | '))

  for (const r of rename) {
    await prisma.$transaction([
      prisma.word.update({ where: { id: r.id }, data: { headword: r.to } }),
      prisma.card.updateMany({
        where: { wordId: r.id, front: r.from },
        data: { front: r.to },
      }),
    ])
  }

  const removeIds = remove.map(r => r.id)
  for (let i = 0; i < removeIds.length; i += 200) {
    const chunk = removeIds.slice(i, i + 200)
    const cards = await prisma.card.findMany({
      where: { wordId: { in: chunk } },
      select: { id: true },
    })
    const cardIds = cards.map(c => c.id)
    if (cardIds.length) {
      await prisma.reviewLog.deleteMany({ where: { cardId: { in: cardIds } } })
      await prisma.card.deleteMany({ where: { id: { in: cardIds } } })
    }
    await prisma.word.deleteMany({ where: { id: { in: chunk } } })
  }

  console.log(`done. renamed=${rename.length} removed=${remove.length}`)
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
