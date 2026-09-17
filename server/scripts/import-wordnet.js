const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { PrismaClient } = require('@prisma/client')

// WordNet 3.0 dict 目录：默认取 devDependency wordnet-db，也可用 WORDNET_DICT_DIR 覆盖
const DICT_DIR =
  process.env.WORDNET_DICT_DIR || path.join(__dirname, '..', 'node_modules', 'wordnet-db', 'dict')

const FILES = [
  ['data.noun', 'n'],
  ['data.verb', 'v'],
  ['data.adj', 'a'],
  ['data.adv', 'r'],
]

const POS_MAP = { n: 'n', v: 'v', a: 'a', s: 'a', r: 'r' }

const loadEnv = () => {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const parseFile = (file, fallbackPos) => {
  const synsets = []
  const senses = []
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(DICT_DIR, file), 'utf8'),
    crlfDelay: Infinity,
  })
  return new Promise(resolve => {
    rl.on('line', line => {
      if (!line || line.startsWith('  ')) return
      const [head, glossRaw] = line.split('|')
      const t = head.trim().split(/\s+/)
      const offset = t[0]
      const ssType = t[2]
      const wCnt = parseInt(t[3], 16)
      const id = `${offset}-${ssType}`
      const pos = POS_MAP[ssType] || fallbackPos
      const gloss = (glossRaw || '').trim()
      synsets.push({ id, pos, gloss })
      const seen = new Set()
      for (let i = 0; i < wCnt; i++) {
        const lemma = t[4 + i * 2].toLowerCase()
        if (seen.has(lemma)) continue
        seen.add(lemma)
        senses.push({ synsetId: id, lemma })
      }
    })
    rl.on('close', () => resolve({ synsets, senses }))
  })
}

const main = async () => {
  loadEnv()
  const prisma = new PrismaClient()

  const synsets = []
  const senses = []
  for (const [file, pos] of FILES) {
    const part = await parseFile(file, pos)
    for (const row of part.synsets) synsets.push(row)
    for (const row of part.senses) senses.push(row)
    console.log(`${file}: synsets=${part.synsets.length} senses=${part.senses.length}`)
  }

  console.log('clearing old wordnet tables...')
  await prisma.wordnetSense.deleteMany({})
  await prisma.wordnetSynset.deleteMany({})

  console.log('writing synsets...')
  for (let i = 0; i < synsets.length; i += 5000) {
    await prisma.wordnetSynset.createMany({ data: synsets.slice(i, i + 5000) })
  }
  console.log('writing senses...')
  for (let i = 0; i < senses.length; i += 5000) {
    await prisma.wordnetSense.createMany({ data: senses.slice(i, i + 5000) })
  }

  console.log(
    `done. synsets=${await prisma.wordnetSynset.count()} senses=${await prisma.wordnetSense.count()}`,
  )
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
