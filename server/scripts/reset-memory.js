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
  const logs = await prisma.reviewLog.deleteMany()
  const cards = await prisma.card.updateMany({
    data: {
      stability: 0,
      difficulty: 0,
      state: 0,
      reps: 0,
      lapses: 0,
      learningSteps: 0,
      interval: 0,
      due: new Date(),
      lastReview: null,
    },
  })
  const params = await prisma.fsrsParam.deleteMany()
  console.log(`cleared: review_logs=${logs.count} cards_reset=${cards.count} fsrs_params=${params.count}`)
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
