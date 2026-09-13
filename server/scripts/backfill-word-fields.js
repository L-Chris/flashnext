const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { PrismaClient } = require('@prisma/client')

const DATA_DIR = path.join(__dirname, 'data')
const ECDICT_FILE = path.join(DATA_DIR, 'ecdict.csv')
const CMUDICT_FILE = path.join(DATA_DIR, 'cmudict.txt')

const VOWELS = {
  AA: ['ɑ', 'ɑ'],
  AE: ['æ', 'æ'],
  AH: ['ʌ', 'ə'],
  AO: ['ɔ', 'ɔ'],
  AW: ['aʊ', 'aʊ'],
  AY: ['aɪ', 'aɪ'],
  EH: ['ɛ', 'ɛ'],
  ER: ['ɝ', 'ɚ'],
  EY: ['e', 'e'],
  IH: ['ɪ', 'ɪ'],
  IY: ['i', 'i'],
  OW: ['o', 'o'],
  OY: ['ɔɪ', 'ɔɪ'],
  UH: ['ʊ', 'ʊ'],
  UW: ['u', 'u'],
}

const CONSONANTS = {
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k',
  L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'r', S: 's', SH: 'ʃ', T: 't',
  TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
}

const arpabetToKK = arpabet => {
  const phonemes = arpabet.trim().split(/\s+/)
  const syllables = []
  let current = { stress: 0, symbols: [] }

  for (const p of phonemes) {
    const m = p.match(/^([A-Z]+)([012])$/)
    if (m) {
      const [, name, stress] = m
      const pair = VOWELS[name]
      if (!pair) return ''
      current.symbols.push(pair[stress === '0' ? 1 : 0])
      current.stress = Number(stress)
      syllables.push(current)
      current = { stress: 0, symbols: [] }
    } else {
      const c = CONSONANTS[p]
      if (!c) return ''
      current.symbols.push(c)
    }
  }
  if (current.symbols.length) syllables.push(current)

  return syllables
    .map(s => (s.stress === 1 ? 'ˈ' : s.stress === 2 ? 'ˌ' : '') + s.symbols.join(''))
    .join('')
}

const collectCmudict = headwords => {
  const wanted = new Set(headwords.map(w => w.headword.toLowerCase()))
  const map = new Map()
  const lines = fs.readFileSync(CMUDICT_FILE, 'utf8').split('\n')
  for (const line of lines) {
    if (!line || line.startsWith(';;;')) continue
    const m = line.match(/^(\S+)\s+(\S.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase().replace(/\(\d+\)$/, '')
    if (!wanted.has(key) || map.has(key)) continue
    map.set(key, m[2])
  }
  return map
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

const collectEcdict = targets => {
  const wanted = new Set(targets.map(w => w.headword.toLowerCase()))
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

const POS_RE = /^((?:[a-z&]+\.\s*)+)/
const DOMAIN_LINE_RE = /^\[[^\]a-zA-Z0-9]{1,8}\]/

const cleanTranslation = raw => {
  const lines = raw.split('\n')
  const kept = lines.filter(l => !DOMAIN_LINE_RE.test(l.trim()))
  return (kept.length ? kept : lines).join('\n').trim()
}

const extractPos = translation => {
  const m = translation.match(POS_RE)
  return m ? m[1].trim() : ''
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

const main = async () => {
  loadEnv()
  const prisma = new PrismaClient()

  const targets = await prisma.word.findMany({
    where: { OR: [{ translation: '' }, { phonetic: '' }, { pos: '' }] },
    select: { id: true, headword: true, pos: true, phonetic: true, translation: true },
  })
  console.log(`words with missing fields: ${targets.length}`)

  console.log('scanning ECDICT / CMUdict for these headwords...')
  const ecdict = await collectEcdict(targets)
  const cmudict = collectCmudict(targets)
  console.log(`ecdict hits: ${ecdict.size}, cmudict hits: ${cmudict.size}`)

  const stats = { translation: 0, phonetic: 0, pos: 0, dirty: 0, unchanged: 0 }
  const stillMissing = []
  const updates = []

  for (const w of targets) {
    const key = w.headword.toLowerCase()
    const ec = ecdict.get(key)
    const data = {}

    let translation = w.translation
    if (translation === 'translation') {
      translation = ''
      stats.dirty += 1
    }
    if (translation.includes('\\r')) {
      translation = translation.replace(/\\r/g, '').trim()
      stats.dirty += 1
    }
    if (!translation) {
      translation = cleanTranslation((ec?.translation || '').replace(/\\n/g, '\n'))
    }
    if (translation !== w.translation) {
      data.translation = translation
      if (!w.translation) stats.translation += 1
    }

    let phonetic = w.phonetic
    if (phonetic.includes('\\r')) {
      phonetic = phonetic.replace(/\\r/g, '').trim()
      stats.dirty += 1
    }
    if (!phonetic) {
      phonetic = arpabetToKK(cmudict.get(key) || '') || ec?.phonetic || ''
    }
    if (phonetic !== w.phonetic) {
      data.phonetic = phonetic
      if (!w.phonetic) stats.phonetic += 1
    }

    const pos = w.pos || extractPos(translation)
    if (pos !== w.pos) {
      data.pos = pos
      if (!w.pos) stats.pos += 1
    }

    if (!data.translation && !data.phonetic && !data.pos) {
      stats.unchanged += 1
      if (stillMissing.length < 15) stillMissing.push(w.headword)
      continue
    }
    updates.push({ id: w.id, data })
  }

  console.log(
    `filled: translation=${stats.translation} phonetic=${stats.phonetic} pos=${stats.pos} ` +
      `dirtyFixed=${stats.dirty} unchanged=${stats.unchanged}`,
  )
  if (stillMissing.length) console.log('still missing (source has no data):', stillMissing.join(', '))

  for (let i = 0; i < updates.length; i += 250) {
    const chunk = updates.slice(i, i + 250)
    await prisma.$transaction(
      chunk.map(u => prisma.word.update({ where: { id: u.id }, data: u.data })),
    )
  }
  console.log(`updated words: ${updates.length}`)
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
