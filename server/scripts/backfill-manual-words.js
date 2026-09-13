const { PrismaClient } = require('@prisma/client')

// 词库源（ECDICT/CMUdict）确实没有收录的词，人工补录释义。
// 体例与 import-words.js 一致：每行一个义项，行首为词性缩写；多义项换行。
const MANUAL_TRANSLATIONS = {
  'arab-israeli': 'a. 阿拉伯与以色列的, 阿以的',
  'israeli-palestinian': 'a. 以色列与巴勒斯坦的',
  'likert-type': 'a. 李克特量表式的（Likert scale 型）',
  'spanish-language': 'a. 西班牙语的',
  'us-led': 'a. 美国主导的',
  'all-white': 'a. 全白人的\na. 全白的',
  'café': 'n. 咖啡馆, 小餐馆',
  'civil-military': 'a. 文职与军事的, 军民的',
  'co-found': 'vt. 共同创立',
  'eight-year': 'a. 八年的',
  'eight-year-old': 'a. 八岁的\nn. 八岁小孩',
  'eighteenth-century': 'a. 十八世纪的',
  'five-day': 'a. 五天的',
  'five-minute': 'a. 五分钟的',
  'four-day': 'a. 四天的',
  'four-hour': 'a. 四小时的',
  'half-mile': 'n. 半英里\na. 半英里的',
  'maneuvre': 'n. 机动, 策略; 演习\nvt. 操纵, 用计谋',
  'medium-low': 'a. 中低的（火候、程度）',
  'mm-hmm': 'int. 嗯嗯（表示赞同或正在听）',
  'nine-year-old': 'a. 九岁的\nn. 九岁小孩',
  'non-materialistic': 'a. 不看重物质的\na. 非唯物主义的',
  'one-room': 'a. 单间的（教室、房屋）',
  'open-access': 'a. 开放获取的, 开放存取的',
  'o’clock': 'ad. …点钟（of the clock）',
  'sauté': 'v. 嫩煎, 稍炒\nn. 嫩煎的菜肴',
  'seven-year': 'a. 七年的',
  'seven-year-old': 'a. 七岁的\nn. 七岁小孩',
  'six-month': 'a. 六个月的',
  'six-week': 'a. 六周的',
  'six-year': 'a. 六年的',
  'six-year-old': 'a. 六岁的\nn. 六岁小孩',
  'sixteenth-century': 'a. 十六世纪的',
  'student-athlete': 'n. 学生运动员',
  'teacher-librarian': 'n. 教师兼图书馆员',
  'ten-year': 'a. 十年的',
  'ten-year-old': 'a. 十岁的\nn. 十岁小孩',
  'third-largest': 'a. 第三大的',
  'three-bedroom': 'a. 三卧室的',
  'three-month': 'a. 三个月的',
  'three-part': 'a. 三部分的',
  'three-week': 'a. 三周的',
  'three-year': 'a. 三年的',
  'two-hour': 'a. 两小时的',
  'underly': 'vt. 位于…之下; 构成…的基础（=underlie）',
  'year-old': 'a. …岁的',
}

// 音标脏数据修正
const MANUAL_PHONETICS = {
  'o’clock': 'əˈklɒk',
}

const POS_RE = /^((?:[a-z&]+\.\s*)+)/
const extractPos = translation => {
  const m = translation.match(POS_RE)
  return m ? m[1].trim() : ''
}

const cardBack = (phonetic, translation) => {
  const parts = []
  if (phonetic) parts.push(`/${phonetic}/`)
  parts.push(translation)
  return parts.join('\n')
}

const loadEnv = () => {
  const fs = require('fs')
  const path = require('path')
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

  // SQLite 不支持 mode:'insensitive'，取候选集后在 JS 里按小写匹配
  const words = await prisma.word.findMany({
    where: { OR: [{ translation: '' }, { phonetic: { endsWith: '/' } }] },
    include: { cards: true },
  })
  console.log(`matched words: ${words.length}`)

  let updated = 0
  let backs = 0
  for (const w of words) {
    const key = w.headword.toLowerCase()
    const translation = MANUAL_TRANSLATIONS[key] ?? w.translation
    const phonetic = MANUAL_PHONETICS[key] ?? w.phonetic
    const pos = extractPos(translation) || w.pos
    const data = {}
    if (translation !== w.translation) data.translation = translation
    if (phonetic !== w.phonetic) data.phonetic = phonetic
    if (pos !== w.pos) data.pos = pos
    if (!Object.keys(data).length) continue

    await prisma.word.update({ where: { id: w.id }, data })
    updated += 1

    const back = cardBack(phonetic, translation)
    for (const card of w.cards) {
      if (card.back !== back) {
        await prisma.card.update({ where: { id: card.id }, data: { back } })
        backs += 1
      }
    }
  }

  console.log(`words updated: ${updated}, card backs refreshed: ${backs}`)
  const missing = Object.keys(MANUAL_TRANSLATIONS).filter(
    k => !words.some(w => w.headword.toLowerCase() === k),
  )
  if (missing.length) console.log('NOT FOUND in db:', missing.join(', '))
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
