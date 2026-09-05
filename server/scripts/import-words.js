const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { PrismaClient } = require('@prisma/client')

const DATA_DIR = path.join(__dirname, 'data')
const COCA_FILE = path.join(DATA_DIR, 'coca-20000.txt')
const ECDICT_FILE = path.join(DATA_DIR, 'ecdict.csv')
const COCA_TR_FILE = path.join(DATA_DIR, 'coca-with-translation.txt')
const TOP_N = Number(process.argv[2]) || 5000

const loadEnv = () => {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const bandOf = rank => {
  if (rank <= 1000) return 1
  if (rank <= 3000) return 2
  if (rank <= 5000) return 3
  if (rank <= 10000) return 4
  return 5
}

const collectHeadwords = () => {
  const lines = fs.readFileSync(COCA_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
  const seen = new Set()
  const words = []
  for (const w of lines) {
    const key = w.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    words.push({ headword: w, rank: words.length + 1 })
    if (words.length >= TOP_N) break
  }
  return words
}

const parseCSVLine = line => {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else q = false
      } else cur += c
    } else {
      if (c === '"') q = true
      else if (c === ',') { out.push(cur); cur = '' }
      else cur += c
    }
  }
  out.push(cur)
  return out
}

const collectEcdict = headwords => {
  const wanted = new Set(headwords.map(w => w.headword.toLowerCase()))
  const map = new Map()

  const rl = readline.createInterface({ input: fs.createReadStream(ECDICT_FILE, 'utf8'), crlfDelay: Infinity })
  return new Promise(resolve => {
    rl.on('line', line => {
      if (!line) return
      const cols = parseCSVLine(line)
      const key = cols[0].toLowerCase()
      if (!wanted.has(key) || map.has(key)) return
      map.set(key, { phonetic: cols[1] || '', translation: cols[3] || '' })
    })
    rl.on('close', () => resolve(map))
  })
}

const collectTranslations = headwords => {
  const wanted = new Set(headwords.map(w => w.headword.toLowerCase()))
  const map = new Map()
  const lines = fs.readFileSync(COCA_TR_FILE, 'utf8').split('\n')
  let current = null
  let buffer = []

  const flush = () => {
    if (current && buffer.length && wanted.has(current) && !map.has(current)) {
      map.set(current, buffer.join('\n'))
    }
    current = null
    buffer = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^——+$/.test(line)) { flush(); continue }
    if (!line) continue
    if (current === null) {
      current = line.toLowerCase()
    } else {
      buffer.push(line)
    }
  }
  flush()
  return map
}

const POS_RE = /^((?:[a-z&]+\.\s*)+)/

const extractPos = translation => {
  const m = translation.match(POS_RE)
  return m ? m[1].trim() : ''
}

const main = async () => {
  loadEnv()
  const prisma = new PrismaClient()

  console.log(`collecting top ${TOP_N} COCA headwords...`)
  const headwords = collectHeadwords()
  console.log(`headwords: ${headwords.length}`)

  console.log('scanning ECDICT for phonetic/translation...')
  const ecdict = await collectEcdict(headwords)

  console.log('parsing COCA translation fallback...')
  const fallback = collectTranslations(headwords)

  const rows = headwords.map(({ headword, rank }) => {
    const key = headword.toLowerCase()
    const ec = ecdict.get(key)
    const translation = (ec?.translation || fallback.get(key) || '').replace(/\\n/g, '\n')
    return {
      headword,
      rank,
      band: bandOf(rank),
      pos: extractPos(translation),
      phonetic: ec?.phonetic || '',
      translation,
    }
  })

  const noTranslation = rows.filter(r => !r.translation).length
  console.log(`missing translation: ${noTranslation}`)

  console.log('writing to database...')
  const chunkSize = 250
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    await prisma.$transaction(
      chunk.map(row =>
        prisma.word.upsert({
          where: { headword: row.headword },
          update: row,
          create: row,
        }),
      ),
    )
  }

  const total = await prisma.word.count()
  console.log(`done. words in database: ${total}`)
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
