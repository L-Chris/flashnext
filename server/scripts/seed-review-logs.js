const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const envPath = path.join(__dirname, '..', '.env')
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const prisma = new PrismaClient()

const main = async () => {
  const cards = await prisma.card.findMany({
    where: { deckId: 1 },
    take: 250,
    orderBy: { id: 'asc' },
  })

  const logs = []
  for (const card of cards) {
    let t = Date.now() - (40 + Math.random() * 40) * 86400000
    let interval = 1
    const n = 5 + Math.floor(Math.random() * 4)
    for (let i = 0; i < n; i++) {
      const recalled = Math.random() < 0.9
      const rating = recalled
        ? Math.random() < 0.7
          ? 3
          : Math.random() < 0.5
            ? 4
            : 2
        : 1
      logs.push({ cardId: card.id, rating, reviewAt: new Date(t) })
      t += interval * 86400000 * (0.8 + Math.random() * 0.4)
      interval =
        rating === 1
          ? 1
          : Math.max(1, Math.round(interval * (rating === 4 ? 2.5 : rating === 3 ? 2 : 1.2)))
    }
  }

  await prisma.reviewLog.createMany({ data: logs })
  console.log('seeded review logs:', logs.length)
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
