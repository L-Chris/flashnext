import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'

// 词头归一化：小写 + 空格/连字符 -> 下划线，与 WordNet lemma 形式对齐
const NORM = "replace(replace(lower(w.headword), ' ', '_'), '-', '_')"

// 我们词库的词性 -> WordNet 词性
const POS_SQL = `CASE
  WHEN w.pos LIKE 'adv%' THEN 'r'
  WHEN w.pos LIKE 'n%' THEN 'n'
  WHEN w.pos LIKE 'v%' THEN 'v'
  WHEN w.pos LIKE 'a%' THEN 'a'
  ELSE NULL END`

// 成员 = 当前带 coca/cet/ielts 标签的词，且词性与 synset 词性一致（实时求交集，不物化到表）
const MEMBER_JOIN = `FROM wordnet_senses s
  JOIN words w ON s.lemma = ${NORM}
  JOIN word_tags t ON t.word_id = w.id AND t.scheme IN ('coca', 'cet', 'ielts')
  JOIN wordnet_synsets syn ON syn.id = s.synset_id AND syn.pos = ${POS_SQL}`

const POS_LABEL: Record<string, string> = { n: 'n.', v: 'v.', a: 'a.', r: 'adv.' }

/** gloss = 定义 + 若干带引号例句，用 '; ' 分隔 */
const parseGloss = (gloss: string) => {
  const definitions: string[] = []
  const examples: string[] = []
  for (const raw of gloss.split('; ')) {
    const part = raw.trim()
    if (!part) continue
    if (part.startsWith('"')) examples.push(part.replace(/^"+/, '').replace(/"+$/, ''))
    else definitions.push(part)
  }
  return { definition: definitions.join('; '), examples }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 成员词的常见变形，用于在例句里字面认领 */
const variantPattern = (headword: string) => {
  const b = headword.toLowerCase()
  const set = new Set([b])
  const tail = (suffix: string) => set.add(b + suffix)
  tail('s')
  tail('es')
  tail('d')
  tail('ed')
  tail('ing')
  if (b.endsWith('e')) set.add(b.slice(0, -1) + 'ing')
  if (b.endsWith('y')) set.add(b.slice(0, -1) + 'ies')
  if (b.length >= 3) {
    const last = b[b.length - 1]
    const prev = b[b.length - 2]
    if (!'aeiou'.includes(last) && 'aeiou'.includes(prev)) set.add(b + last + 'ing')
  }
  return new Set([...set].map(escapeRe))
}

const matchExamples = (examples: string[], headwords: string[]): SynonymExample[] => {
  const patterns = headwords.map(hw => ({
    hw,
    re: new RegExp(`\\b(${[...variantPattern(hw)].join('|')})\\b`, 'i'),
  }))
  return examples.map(text => ({
    text,
    members: patterns.filter(p => p.re.test(text)).map(p => p.hw),
  }))
}

// 取词库释义的第一义项作为该成员的中文
const zhOf = (translation: string) => {
  const first = (translation || '').split('\n')[0] || ''
  const body = first.replace(/^(?:[a-z&]+\.\s*)+/, '')
  return body.split(/[,;，；]/)[0].trim()
}

export interface SynonymMember {
  headword: string
  zh: string
}

export interface SynonymExample {
  text: string
  /** 例句中字面出现的成员词（WordNet 无对齐字段，按词形匹配推断） */
  members: string[]
}

export interface SynonymGroup {
  id: string
  pos: string
  posLabel: string
  gloss: string
  /** gloss 中不带引号的定义部分 */
  definition: string
  /** gloss 中带引号的例句，已按成员词归属 */
  examples: SynonymExample[]
  /** 常用度 = 成员 SemCor 频次之和 / 成员数，越大越常见 */
  commonness: number
  /** 成员 SemCor 频次之和（原始值） */
  semcorTotal: number
  members: SynonymMember[]
}

interface CachedGroup extends SynonymGroup {
  memberKeys: Set<string>
}

const MEMBER_CHUNK = 500

// SemCor 频次低于该值视为生僻义组
export const RARE_THRESHOLD = 10

@Service()
export class SynonymsService {
  private cache: { stamp: string; groups: CachedGroup[] } | null = null

  /** 词表指纹：词/标签的行数、最大 id、释义总长度任一变化即失效缓存 */
  private async stamp(): Promise<string> {
    const [w, t] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ n: bigint; m: bigint; s: bigint }>>(
        `SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m, COALESCE(SUM(LENGTH(translation)), 0) AS s FROM words`,
      ),
      prisma.$queryRawUnsafe<Array<{ n: bigint; m: bigint }>>(
        `SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM word_tags`,
      ),
    ])
    return `${w[0].n}:${w[0].m}:${w[0].s}:${t[0].n}:${t[0].m}`
  }

  private async sensesOf(synsetIds: string[]) {
    const out: Array<{ synset_id: string; lemma: string; semcor_freq: number; sense_rank: number }> = []
    for (let i = 0; i < synsetIds.length; i += MEMBER_CHUNK) {
      const chunk = synsetIds.slice(i, i + MEMBER_CHUNK)
      const rows = await prisma.$queryRawUnsafe<
        Array<{ synset_id: string; lemma: string; semcor_freq: number; sense_rank: number }>
      >(
        `SELECT synset_id, lemma, semcor_freq, sense_rank
         FROM wordnet_senses WHERE synset_id IN (${chunk.map(() => '?').join(',')})`,
        ...chunk,
      )
      out.push(...rows)
    }
    return out
  }

  // 表达式 IN 无法走索引，但整表 1.8 万行扫描一次只要几十毫秒，按块跑即可
  private async wordsByKeys(keys: string[]) {
    const out: Array<{ id: number; headword: string; rank: number | null; pos: string; translation: string }> = []
    for (let i = 0; i < keys.length; i += MEMBER_CHUNK) {
      const chunk = keys.slice(i, i + MEMBER_CHUNK)
      const rows = await prisma.$queryRawUnsafe<
        Array<{ id: number; headword: string; rank: number | null; pos: string; translation: string }>
      >(
        `SELECT id, headword, rank, pos, translation FROM words
         WHERE ${NORM.replace(/w\./g, '')} IN (${chunk.map(() => '?').join(',')})`,
        ...chunk,
      )
      out.push(...rows)
    }
    return out
  }

  private async taggedWordIds() {
    const rows = await prisma.$queryRawUnsafe<Array<{ word_id: number }>>(
      `SELECT DISTINCT word_id FROM word_tags WHERE scheme IN ('coca', 'cet', 'ielts')`,
    )
    return new Set(rows.map(r => Number(r.word_id)))
  }

  /** 全量构建一次并缓存；之后所有查询在内存里过滤/分页 */
  private async ensureCache(): Promise<CachedGroup[]> {
    const stamp = await this.stamp()
    if (this.cache && this.cache.stamp === stamp) return this.cache.groups

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; pos: string; gloss: string; members: bigint }>>(
      `SELECT s.synset_id AS id, syn.pos AS pos, syn.gloss AS gloss, COUNT(DISTINCT w.id) AS members
       ${MEMBER_JOIN}
       GROUP BY s.synset_id HAVING COUNT(DISTINCT w.id) >= 2
       ORDER BY members DESC, syn.id`,
    )

    const synsetIds = rows.map(r => r.id)
    const senses = await this.sensesOf(synsetIds)
    const lemmaSet = [...new Set(senses.map(x => x.lemma))]
    const words = await this.wordsByKeys(lemmaSet)
    const wordByKey = new Map(words.map(w => [w.headword.toLowerCase().replace(/[\s-]+/g, '_'), w]))
    const tagged = await this.taggedWordIds()
    const posOf = (p: string) =>
      p.startsWith('adv') ? 'r' : p.startsWith('n') ? 'n' : p.startsWith('v') ? 'v' : p.startsWith('a') ? 'a' : null

    const posById = new Map(rows.map(r => [r.id, r.pos] as const))
    const membersBySynset = new Map<string, Array<SynonymMember & { rank: number | null }>>()
    const commonBySynset = new Map<string, number>()
    for (const sense of senses) {
      const word = wordByKey.get(sense.lemma)
      if (!word || !tagged.has(word.id) || posOf(word.pos || '') !== posById.get(sense.synset_id)) continue
      const list = membersBySynset.get(sense.synset_id) || []
      list.push({ headword: word.headword, zh: zhOf(word.translation), rank: word.rank })
      membersBySynset.set(sense.synset_id, list)
      commonBySynset.set(
        sense.synset_id,
        (commonBySynset.get(sense.synset_id) || 0) + (Number(sense.semcor_freq) || 0),
      )
    }

    const groups: CachedGroup[] = rows.map(r => {
      const memberList = membersBySynset.get(r.id) || []
      const parsed = parseGloss(r.gloss)
      const members = memberList
        .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.headword.localeCompare(b.headword))
        .map(({ rank, ...m }) => {
          void rank
          return m
        })
      const total = commonBySynset.get(r.id) || 0
      return {
        id: r.id,
        pos: r.pos,
        posLabel: POS_LABEL[r.pos] || r.pos,
        gloss: r.gloss,
        definition: parsed.definition,
        examples: matchExamples(parsed.examples, members.map(m => m.headword)),
        commonness: members.length ? Math.round((total / members.length) * 10) / 10 : 0,
        semcorTotal: total,
        members,
        memberKeys: new Set(members.map(m => m.headword.toLowerCase())),
      }
    })
    groups.sort(
      (a, b) =>
        b.commonness - a.commonness ||
        b.members.length - a.members.length ||
        a.id.localeCompare(b.id),
    )
    this.cache = { stamp, groups }
    return groups
  }

  async groups(query: {
    page: number
    pageSize: number
    q: string
    mode: string
    hideRare: boolean
  }) {
    const { page, pageSize } = query
    const needle = query.q.trim().toLowerCase()
    const mode = query.mode === 'word' || query.mode === 'definition' ? query.mode : 'all'
    const all = await this.ensureCache()

    const filtered = all.filter(g => {
      if (query.hideRare && g.commonness < RARE_THRESHOLD) return false
      if (!needle) return true
      const byWord = g.members.some(m => m.headword.toLowerCase().includes(needle))
      const byDefinition = g.definition.toLowerCase().includes(needle)
      if (mode === 'word') return byWord
      if (mode === 'definition') return byDefinition
      return byWord || byDefinition
    })

    const total = filtered.length
    const pages = Math.max(1, Math.ceil(total / pageSize))
    const safePage = Math.min(Math.max(1, page), pages)
    const groups: SynonymGroup[] = filtered
      .slice((safePage - 1) * pageSize, safePage * pageSize)
      .map(({ memberKeys, ...g }) => {
        void memberKeys
        return g
      })

    return { groups, total, page: safePage, pages, pageSize }
  }

  async wordGroups(headword: string) {
    const key = headword.trim().toLowerCase()
    const normKey = key.replace(/[\s-]+/g, '_')
    const all = await this.ensureCache()
    const groups: SynonymGroup[] = all
      .filter(g => g.memberKeys.has(key) || g.memberKeys.has(normKey) || g.memberKeys.has(key.replace(/[\s-]+/g, ' ')))
      .map(({ memberKeys, ...g }) => {
        void memberKeys
        return g
      })
    return { groups, headword: headword.trim() }
  }
}
