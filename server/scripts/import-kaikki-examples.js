const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { PrismaClient } = require('@prisma/client')

const FILE = path.join(__dirname, 'data', 'kaikki.org-dictionary-English.jsonl')
const STATUS = path.join(__dirname, 'data', 'kaikki-import.status')
const MAX_SENSES = 3
const MAX_EXAMPLES = 2
const MAX_ZH = 3

const loadEnv = () => {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const cleanExample = text => {
  if (!text) return null
  const t = String(text).replace(/\s+/g, ' ').trim()
  if (t.length < 15 || t.length > 140) return null
  if (/ſ/.test(t)) return null // 古引文长 s
  if (/^\d{4}[,.]/.test(t)) return null // 年份引证开头
  if (/^\w+,\s[A-Z]/.test(t) && /,\s/.test(t.slice(0, 24))) return null // 出处开头
  return t
}

const cleanZh = w => {
  if (!w) return null
  let t = String(w).trim()
  const m = t.match(/^(.+?)\s*\/\s*([^/]+)$/)
  if (m) t = m[2] // 繁 / 简 并列取简体
  t = t.trim()
  if (!/^[\u4e00-\u9fa5]{1,12}$/.test(t)) return null
  return t
}

const main = async () => {
  loadEnv()
  const prisma = new PrismaClient()
  const words = await prisma.word.findMany({
    where: { cards: { some: {} } },
    select: { id: true, headword: true },
  })
  const idByHeadword = new Map(words.map(w => [w.headword, w.id]))
  console.log(`vocab with cards: ${idByHeadword.size}`)

  const collected = new Map()
  const rl = readline.createInterface({
    input: fs.createReadStream(FILE, 'utf8'),
    crlfDelay: Infinity,
  })

  let lines = 0
  let stats = { senses: 0, examples: 0, zh: 0, droppedExamples: 0 }
  rl.on('line', line => {
    lines += 1
    if (lines % 200000 === 0) {
      console.log(`  scanned ${lines} lines, collected ${collected.size}/${idByHeadword.size}`)
      fs.writeFileSync(STATUS, `scanning lines=${lines} collected=${collected.size}\n`)
    }
    if (line.indexOf('"word":') < 0) return
    let e
    try {
      e = JSON.parse(line)
    } catch {
      return
    }
    const wordId = idByHeadword.get(e.word)
    if (wordId === undefined || collected.has(wordId)) return
    const senses = []
    ;(e.senses || []).forEach((s, idx) => {
      if (senses.length >= MAX_SENSES) return
      const rawEx = (s.examples || []).map(x => cleanExample(x && x.text)).filter(Boolean)
      if (!rawEx.length) return
      const zh = [
        ...new Set(
          (s.translations || [])
            .filter(t => ['zh', 'zh-Hans', 'zh-Hant', 'cmn'].includes(t.code))
            .map(t => cleanZh(t.word))
            .filter(Boolean),
        ),
      ].slice(0, MAX_ZH)
      senses.push({
        wordId,
        senseIdx: idx,
        gloss: ((s.glosses || [])[0] || '').slice(0, 200),
        examples: JSON.stringify(rawEx.slice(0, MAX_EXAMPLES)),
        zh: JSON.stringify(zh),
      })
      stats.senses += 1
      stats.examples += Math.min(rawEx.length, MAX_EXAMPLES)
      stats.zh += zh.length
    })
    if (senses.length) collected.set(wordId, senses)
  })

  await new Promise(resolve => rl.on('close', resolve))
  console.log(`scan done: lines=${lines} words=${collected.size} ${JSON.stringify(stats)}`)

  let written = 0
  const entries = [...collected.values()]
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500).flat()
    const ids = [...new Set(chunk.map(c => c.wordId))]
    await prisma.$transaction([
      prisma.wordSense.deleteMany({ where: { wordId: { in: ids } } }),
      prisma.wordSense.createMany({ data: chunk }),
    ])
    written += chunk.length
  }
  console.log(`word_senses rows: ${written}`)
  fs.writeFileSync(STATUS, `done words=${collected.size} rows=${written} ${JSON.stringify(stats)}\n`)
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  fs.writeFileSync(STATUS, `error ${err.message}\n`)
  process.exit(1)
})
