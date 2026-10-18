const fs = require('fs')
const path = require('path')
const { lookupEcdict } = require('./lib/ecdict')
const { PrismaClient } = require('@prisma/client')
const { importIeltsUsages } = require('./import-ielts-usages')

const DATA_DIR = path.join(__dirname, 'data')
const IELTS_FILE = path.join(DATA_DIR, 'ielts.txt')
const ECDICT_FILE = path.join(DATA_DIR, 'ecdict.csv')

const SCHEME = 'ielts'
const LEVEL = 1
const LABEL = '雅思核心'

const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const prisma = new PrismaClient()

const parseWords = file => {
  const words = new Set()
  if (!fs.existsSync(file)) {
    throw new Error(`File not found: ${file}`)
  }
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    // 如果带空格（如短语或复合词），保留纯字母/连字符/空格词
    const token = line.replace(/[\r\n]/g, '').trim()
    if (!/^[A-Za-z][A-Za-z'\-.\s]*$/.test(token)) continue
    words.add(token)
  }
  return [...words]
}

const main = async () => {
  console.log(`parsing ${IELTS_FILE}...`)
  const list = parseWords(IELTS_FILE)
  console.log(`total unique IELTS words in list: ${list.length}`)

  // 1. 获取现有词库
  const allWords = await prisma.word.findMany({
    select: { id: true, headword: true },
  })
  const wordByKey = new Map(allWords.map(w => [w.headword, w]))

  // 2. 检查未入库的词
  const missing = list.filter(w => !wordByKey.has(w))
  console.log(`words matched in DB: ${list.length - missing.length}, missing: ${missing.length}`)

  if (missing.length > 0) {
    console.log(`looking up ${missing.length} missing words in ECDICT...`)
    const ecdictMap = await lookupEcdict(ECDICT_FILE, missing)
    let createdCount = 0

    for (const key of missing) {
      const info = ecdictMap.get(key)
      if (!info) continue

      const entity = await prisma.knowledgeEntity.upsert({
        where: { canonicalKey: `en:word:${key}` },
        update: { title: info.headword, summary: info.translation },
        create: {
          kind: 'word',
          canonicalKey: `en:word:${key}`,
          title: info.headword,
          summary: info.translation,
        },
      })

      const word = await prisma.word.create({
        data: {
          headword: info.headword,
          rank: null,
          pos: info.pos,
          phonetic: info.phonetic,
          translation: info.translation,
          knowledgeEntityId: entity.id,
        },
      })

      wordByKey.set(key, word)
      createdCount++
    }
    console.log(`auto-created words from ECDICT: ${createdCount}`)
  }

  // 3. 打标签
  const existingTags = await prisma.wordTag.findMany({
    where: { scheme: SCHEME },
    select: { wordId: true, level: true },
  })
  const haveTag = new Set(existingTags.map(t => `${t.wordId}:${t.level}`))

  const tagRows = []
  let notInDb = 0
  for (const key of list) {
    const word = wordByKey.get(key)
    if (!word) {
      notInDb++
      continue
    }
    if (haveTag.has(`${word.id}:${LEVEL}`)) continue
    tagRows.push({
      wordId: word.id,
      scheme: SCHEME,
      level: LEVEL,
      label: LABEL,
    })
  }

  for (let i = 0; i < tagRows.length; i += 1000) {
    await prisma.wordTag.createMany({
      data: tagRows.slice(i, i + 1000),
    })
  }

  const totalIeltsTags = await prisma.wordTag.count({ where: { scheme: SCHEME } })

  console.log('--- IELTS Import Summary ---')
  console.log(`List count:       ${list.length}`)
  console.log(`New tags added:   ${tagRows.length}`)
  console.log(`Total tagged now: ${totalIeltsTags}`)
  if (notInDb > 0) {
    console.log(`Not in library:   ${notInDb}`)
  }

  console.log('IELTS chapter usages:', await importIeltsUsages(prisma))
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
