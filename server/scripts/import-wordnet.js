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

// index.sense 的 sense key 位: 1=n 2=v 3=a 4=r 5=s(卫星)
const SENSE_KEY_POS = { 1: 'n', 2: 'v', 3: 'a', 4: 'r', 5: 's' }

// 读 index.sense: lemma%pos:file:lex:: synset_offset sense_number semcor_freq
const collectSenseStats = () => {
  const map = new Map()
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(DICT_DIR, 'index.sense'), 'utf8'),
    crlfDelay: Infinity,
  })
  return new Promise(resolve => {
    rl.on('line', line => {
      const t = line.trim().split(/\s+/)
      if (t.length < 4) return
      const m = t[0].match(/^([^%]+)%(\d):/)
      if (!m) return
      const pos = SENSE_KEY_POS[Number(m[2])]
      if (!pos) return
      const key = `${t[1]}-${pos}`
      const lemma = m[1].toLowerCase()
      const prev = map.get(key) || new Map()
      prev.set(lemma, { senseRank: Number(t[2]), semcorFreq: Number(t[3]) })
      map.set(key, prev)
    })
    rl.on('close', () => resolve(map))
  })
}

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
        senses.push({ synsetId: id, lemma, semcorFreq: 0, senseRank: 1 })
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

  console.log('reading index.sense (SemCor freq + sense rank)...')
  const stats = await collectSenseStats()
  let hit = 0
  for (const row of senses) {
    const byLemma = stats.get(row.synsetId)
    const st = byLemma && byLemma.get(row.lemma)
    if (st) {
      row.semcorFreq = st.semcorFreq
      row.senseRank = st.senseRank
      hit++
    }
  }
  console.log(`sense stats matched: ${hit}/${senses.length}`)

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
