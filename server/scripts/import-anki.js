const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const ANKI = 'http://localhost:8765'
const DECK_ROOT = process.argv[2] || '1-考研-英语单词'
const SKIP_DECK_KEYWORDS = ['近形词']
const SINGLE_DECK_NAME = '英语单词'

const envPath = path.join(__dirname, '..', '.env')
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const prisma = new PrismaClient()

const invoke = async (action, params = {}) => {
  const res = await fetch(ANKI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params, version: 6 }),
  })
  const body = await res.json()
  if (body.error) throw new Error(`${action}: ${body.error}`)
  return body.result
}

const stripHtml = s => (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()

const PURE_RE = /^[\p{L}]+(?:[-'’][\p{L}]+)*$/u

const decodeEntities = s =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')

const normalizeHeadword = raw => {
  let s = decodeEntities(raw || '')
  s = s.replace(/(?:^\[[^\]]*\])+/, '')
  s = s.replace(/\([^)]*\)/g, '')
  if (s.includes('/')) s = s.split('/')[0]
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^[.\s]+|[.\s]+$/g, '')
  return s
}

const WORD_FIELD_NAMES = ['单词', 'voca', 'shadow', '正面', 'word', 'Word']
const PHONETIC_FIELD_NAMES = ['音标', 'Symbol', 'phonetic']
const DEF_FIELD_NAMES = ['解释', 'Chn', 'frontcn', '背面', 'translation']
const ENCRYPTED_MARKERS = ['≯#', '#≮']

const isEncrypted = s => ENCRYPTED_MARKERS.some(m => s.includes(m))

const WORD_LIKE_RE = /^[A-Za-z][A-Za-z'\-. ]*$/

const pickField = (fields, names) => {
  for (const name of names) {
    const f = fields.find(x => x.name === name)
    if (f) {
      const value = stripHtml(f.value)
      if (value && !isEncrypted(value)) return value
    }
  }
  return ''
}

const extractNote = rawFields => {
  const fields = Object.entries(rawFields || {})
    .map(([name, f]) => ({ name, value: f.value, order: f.order }))
    .sort((a, b) => a.order - b.order)

  let headword = pickField(fields, WORD_FIELD_NAMES)
  if (!headword) {
    const wordLike = fields.find(f => {
      const v = stripHtml(f.value)
      return v && !isEncrypted(v) && WORD_LIKE_RE.test(v) && v.length <= 40
    })
    headword = wordLike ? stripHtml(wordLike.value) : stripHtml(fields[0]?.value)
  }

  const phonetic = pickField(fields, PHONETIC_FIELD_NAMES).replace(/^\[|\]$/g, '')
  const definition = pickField(fields, DEF_FIELD_NAMES)

  return { headword, phonetic, definition }
}

const chunk = (arr, size) => {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const POS_RE = /^((?:[a-z&]+\.\s*)+)/

const cardBack = (phonetic, translation) => {
  const parts = []
  if (phonetic) parts.push(`/${phonetic}/`)
  parts.push(translation)
  return parts.join('\n')
}

const main = async () => {
  console.log(`fetching decks under "${DECK_ROOT}"...`)
  const allDecks = await invoke('deckNames')
  const inRoot = d => d === DECK_ROOT || d.startsWith(DECK_ROOT + '::')
  const skippedDecks = allDecks.filter(d => inRoot(d) && SKIP_DECK_KEYWORDS.some(k => d.includes(k)))
  const decks = allDecks.filter(d => inRoot(d) && !SKIP_DECK_KEYWORDS.some(k => d.includes(k)))
  const queryFor = d =>
    d === DECK_ROOT && skippedDecks.length > 0
      ? `deck:"${d}" ` + skippedDecks.map(s => `-deck:"${s}"`).join(' ')
      : `deck:"${d}"`
  console.log(`decks: ${decks.length} (skipped: ${skippedDecks.join(', ') || 'none'})`)

  console.log('fetching notes...')
  const noteIds = new Set()
  for (const deck of decks) {
    const ids = await invoke('findNotes', { query: queryFor(deck) })
    ids.forEach(id => noteIds.add(id))
  }
  const noteIdList = [...noteIds]
  console.log(`notes: ${noteIdList.length}`)

  const cidToWord = new Map()
  const wordInfos = new Map()
  for (const batch of chunk(noteIdList, 2000)) {
    const infos = await invoke('notesInfo', { notes: batch })
    for (const note of infos) {
      if (!note) continue
      const extracted = extractNote(note.fields)
      const headword = normalizeHeadword(extracted.headword)
      if (!headword || !PURE_RE.test(headword)) continue
      const { phonetic, definition } = extracted
      const key = headword.toLowerCase()
      if (!wordInfos.has(key)) {
        wordInfos.set(key, { headword, definition, phonetic })
      }
      for (const cid of note.cards || []) cidToWord.set(cid, key)
    }
  }
  console.log(`unique words: ${wordInfos.size}`)

  console.log('fetching review logs...')
  const logsByWord = new Map()
  let totalReviews = 0
  for (const deck of decks) {
    const reviews = await invoke('cardReviews', { deck, startID: 0 })
    for (const row of reviews) {
      const [idMs, cid, , ease, , , , took, type] = row
      if (ease < 1 || ease > 4 || type === 3) continue
      const word = cidToWord.get(cid)
      if (!word) continue
      totalReviews++
      if (!logsByWord.has(word)) logsByWord.set(word, [])
      logsByWord.get(word).push({ t: idMs, rating: ease, type, took })
    }
  }
  for (const logs of logsByWord.values()) logs.sort((a, b) => a.t - b.t)
  console.log(`reviews: ${totalReviews}, words with history: ${logsByWord.size}`)

  console.log('matching against word library...')
  const allWords = await prisma.word.findMany({})
  const existingByKey = new Map(allWords.map(w => [w.headword.toLowerCase(), w]))
  const matched = new Set([...wordInfos.keys()].filter(k => existingByKey.has(k)))
  const unmatchedAll = [...wordInfos.keys()].filter(k => !matched.has(k))
  const unmatched = unmatchedAll.filter(k => logsByWord.has(k))
  console.log(
    `matched: ${matched.size}, unmatched: ${unmatchedAll.length} (with history: ${unmatched.length}, skipped no-history: ${unmatchedAll.length - unmatched.length})`,
  )

  let importDeck = await prisma.deck.findFirst({ where: { name: SINGLE_DECK_NAME } })
  if (!importDeck) {
    importDeck = await prisma.deck.create({
      data: { name: SINGLE_DECK_NAME, description: '全部单词卡片' },
    })
  }

  console.log('creating words/cards for unmatched...')
  const wordIdByKey = new Map()
  const wordRowByKey = new Map()
  for (const [key, w] of existingByKey) {
    if (!wordInfos.has(key)) continue
    wordIdByKey.set(key, w.id)
    wordRowByKey.set(key, w)
  }
  let createdWords = 0
  for (let i = 0; i < unmatched.length; i++) {
    const key = unmatched[i]
    const info = wordInfos.get(key)
    const pos = (info.definition.match(POS_RE) || [])[1]?.trim() || ''
    const word = await prisma.word.create({
      data: {
        headword: info.headword,
        rank: null,
        pos,
        phonetic: info.phonetic || '',
        translation: info.definition || '',
      },
    })
    wordIdByKey.set(key, word.id)
    wordRowByKey.set(key, word)
    await prisma.card.create({
      data: {
        deckId: importDeck.id,
        wordId: word.id,
        front: info.headword,
        back: cardBack(info.phonetic, info.definition),
      },
    })
    createdWords++
  }
  console.log(`created words: ${createdWords}`)

  console.log('ensuring cards for studied words without cards...')
  const studiedKeys = [...logsByWord.keys()]
  const studiedWordIds = studiedKeys.map(k => wordIdByKey.get(k)).filter(Boolean)
  const existingCards = await prisma.card.findMany({
    where: { wordId: { in: studiedWordIds } },
    select: { wordId: true },
  })
  const wordIdsWithCard = new Set(existingCards.map(c => c.wordId))
  let ensuredCards = 0
  for (const key of studiedKeys) {
    const wordId = wordIdByKey.get(key)
    if (!wordId || wordIdsWithCard.has(wordId)) continue
    const row = wordRowByKey.get(key)
    await prisma.card.create({
      data: {
        deckId: importDeck.id,
        wordId,
        front: row.headword,
        back: cardBack(row.phonetic, row.translation),
      },
    })
    ensuredCards++
  }
  console.log(`ensured cards: ${ensuredCards}`)

  console.log('writing review logs...')
  const canonicalCards = await prisma.card.findMany({
    where: { wordId: { in: [...wordIdByKey.values()] } },
    orderBy: { createdAt: 'asc' },
  })
  const canonicalByWordId = new Map()
  const allByWordId = new Map()
  for (const card of canonicalCards) {
    if (!canonicalByWordId.has(card.wordId)) canonicalByWordId.set(card.wordId, card.id)
    if (!allByWordId.has(card.wordId)) allByWordId.set(card.wordId, [])
    allByWordId.get(card.wordId).push(card.id)
  }

  // Anki revlog type -> fsrs-rs review_state（0 new / 1 learning / 2 review / 3 relearning）
  const stateOf = (log, index) => {
    if (index === 0) return 0
    if (log.type === 0) return 1
    if (log.type === 2) return 3
    return 2
  }

  const logRows = []
  for (const [key, logs] of logsByWord) {
    const wordId = wordIdByKey.get(key)
    const cardId = canonicalByWordId.get(wordId)
    if (!cardId) continue
    logs.forEach((log, index) => {
      logRows.push({
        cardId,
        rating: log.rating,
        reviewAt: new Date(log.t),
        state: stateOf(log, index),
        durationMs: Math.max(0, Number(log.took) || 0),
      })
    })
  }
  for (const batch of chunk(logRows, 1000)) {
    await prisma.reviewLog.createMany({ data: batch })
  }
  console.log(`review logs written: ${logRows.length}`)

  // 记忆状态不再由本脚本重放：统一交给服务端 POST /api/fsrs/rebuild，
  // 那里使用与在线复习完全相同的调度实现（日切点对齐、learn-ahead、fuzz）。
  console.log('review logs imported. next steps:')
  console.log('  1) POST /api/fsrs/rebuild            重建记忆状态并回填 review_state')
  console.log('  2) GET  /api/fsrs/rebuild            轮询进度与 due 预报')
  console.log('  3) POST /api/fsrs/optimize           （可选）用 fsrs-rs 训练参数')
  console.log('done.')
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
