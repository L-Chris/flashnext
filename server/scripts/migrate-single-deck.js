const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const SINGLE_DECK_NAME = '英语单词'

const COCA_LABELS = {
  1: 'L1 核心高频',
  2: 'L2 常用',
  3: 'L3 进阶',
  4: 'L4 扩展',
  5: 'L5 学术',
}

const envPath = path.join(__dirname, '..', '.env')
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const prisma = new PrismaClient()

const main = async () => {
  let deck = await prisma.deck.findFirst({ where: { name: SINGLE_DECK_NAME } })
  if (!deck) {
    deck = await prisma.deck.create({ data: { name: SINGLE_DECK_NAME, description: '全部单词卡片' } })
  }
  console.log('single deck id:', deck.id)

  console.log('migrating band -> coca tags...')
  const tagged = await prisma.$queryRaw`
    SELECT id, band FROM words WHERE band BETWEEN 1 AND 5
  `
  const tagRows = tagged.map(w => ({
    wordId: w.id,
    scheme: 'coca',
    level: w.band,
    label: COCA_LABELS[w.band],
  }))
  const existingTags = await prisma.wordTag.findMany({
    where: { scheme: 'coca' },
    select: { wordId: true, level: true },
  })
  const have = new Set(existingTags.map(t => `${t.wordId}:${t.level}`))
  const newTags = tagRows.filter(r => !have.has(`${r.wordId}:${r.level}`))
  for (let i = 0; i < newTags.length; i += 1000) {
    await prisma.wordTag.createMany({ data: newTags.slice(i, i + 1000) })
  }
  console.log('coca tags:', newTags.length)

  console.log('clearing fake ranks of out-of-library words...')
  const cleared = await prisma.word.updateMany({
    where: { band: 6 },
    data: { rank: null },
  })
  console.log('ranks cleared:', cleared.count)

  console.log('merging duplicate word cards...')
  const dupGroups = await prisma.$queryRaw`
    SELECT word_id, COUNT(*) AS n FROM cards WHERE word_id IS NOT NULL GROUP BY word_id HAVING n > 1
  `
  let mergedCards = 0
  let repointedLogs = 0
  for (const g of dupGroups) {
    const cards = await prisma.card.findMany({
      where: { wordId: g.word_id },
      orderBy: { createdAt: 'asc' },
    })
    const keeper = cards[0]
    const dups = cards.slice(1)
    const dupIds = dups.map(c => c.id)
    const logs = await prisma.reviewLog.updateMany({
      where: { cardId: { in: dupIds } },
      data: { cardId: keeper.id },
    })
    repointedLogs += logs.count
    await prisma.card.deleteMany({ where: { id: { in: dupIds } } })
    mergedCards += dupIds.length
  }
  console.log(`merged cards: ${mergedCards}, repointed logs: ${repointedLogs}`)

  console.log('moving word cards into single deck...')
  const moved = await prisma.card.updateMany({
    where: { wordId: { not: null }, deckId: { not: deck.id } },
    data: { deckId: deck.id },
  })
  console.log('moved cards:', moved.count)

  console.log('deleting emptied legacy decks...')
  const legacy = await prisma.deck.findMany({
    where: { OR: [{ name: { startsWith: 'COCA L' } }, { name: 'Anki 导入词' }] },
    include: { _count: { select: { cards: true } } },
  })
  for (const d of legacy) {
    if (d._count.cards > 0) {
      console.log(`  skip ${d.name} (still has ${d._count.cards} cards)`)
      continue
    }
    await prisma.deck.delete({ where: { id: d.id } })
    console.log(`  deleted ${d.name}`)
  }

  console.log('done.')
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
