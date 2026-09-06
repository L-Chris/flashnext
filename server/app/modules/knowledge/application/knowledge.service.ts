import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'

const DEFAULT_PROFILE_ID = 1

const statusFromCard = (card: { reps: number; state: number; stability: number } | null) => {
  if (!card) return { status: 'UNKNOWN', confidence: 0 }
  if (card.reps <= 0) return { status: 'EXPOSED', confidence: 0.25 }
  if (card.state === 1 || card.state === 3) return { status: 'LEARNING', confidence: 0.55 }
  if (card.stability >= 30) return { status: 'MASTERED', confidence: 0.95 }
  return { status: 'KNOWN', confidence: 0.8 }
}

@Service()
export class KnowledgeService {
  async ensureDefaultProfile() {
    return prisma.profile.upsert({
      where: { id: DEFAULT_PROFILE_ID },
      update: {},
      create: { id: DEFAULT_PROFILE_ID, name: 'Default' },
    })
  }

  async getProfile() {
    const profile = await this.ensureDefaultProfile()
    const [entityCount, stateCount, knownCount] = await Promise.all([
      prisma.knowledgeEntity.count(),
      prisma.personalKnowledgeState.count({ where: { profileId: profile.id } }),
      prisma.personalKnowledgeState.count({
        where: { profileId: profile.id, status: { in: ['KNOWN', 'MASTERED'] } },
      }),
    ])
    return { ...profile, entityCount, stateCount, knownCount }
  }

  async syncWords() {
    await this.ensureDefaultProfile()
    const words = await prisma.word.findMany({
      include: {
        cards: {
          orderBy: [{ reps: 'desc' }, { stability: 'desc' }],
          take: 1,
        },
      },
    })

    let linked = 0
    let states = 0
    for (const word of words) {
      const entity = await prisma.knowledgeEntity.upsert({
        where: { canonicalKey: `en:word:${word.headword.toLowerCase()}` },
        update: { title: word.headword, summary: word.translation },
        create: {
          kind: 'word',
          canonicalKey: `en:word:${word.headword.toLowerCase()}`,
          title: word.headword,
          summary: word.translation,
        },
      })

      if (word.knowledgeEntityId !== entity.id) {
        await prisma.word.update({
          where: { id: word.id },
          data: { knowledgeEntityId: entity.id },
        })
        linked++
      }

      const projected = statusFromCard(word.cards[0] ?? null)
      const lastReview = word.cards[0]?.lastReview ?? null
      await prisma.personalKnowledgeState.upsert({
        where: {
          profileId_entityId: {
            profileId: DEFAULT_PROFILE_ID,
            entityId: entity.id,
          },
        },
        update: {
          memoryPolicy: 'FSRS',
          status: projected.status,
          confidence: projected.confidence,
          firstSeenAt: word.cards.length ? word.cards[0].createdAt : null,
          lastEvidenceAt: lastReview,
        },
        create: {
          profileId: DEFAULT_PROFILE_ID,
          entityId: entity.id,
          memoryPolicy: 'FSRS',
          status: projected.status,
          confidence: projected.confidence,
          firstSeenAt: word.cards.length ? word.cards[0].createdAt : null,
          lastEvidenceAt: lastReview,
        },
      })
      states++
    }

    return { words: words.length, linked, states }
  }

  async checkVocabulary(headwords: string[]) {
    const normalized = [...new Set(headwords.map(w => w.trim().toLowerCase()).filter(Boolean))]
    if (normalized.length === 0) return []

    const rows = await prisma.word.findMany({
      where: { headword: { in: normalized } },
      include: {
        tags: true,
        knowledgeEntity: {
          include: {
            states: { where: { profileId: DEFAULT_PROFILE_ID }, take: 1 },
          },
        },
        cards: {
          orderBy: [{ reps: 'desc' }, { stability: 'desc' }],
          take: 1,
        },
      },
    })

    const byHeadword = new Map(rows.map(row => [row.headword.toLowerCase(), row]))
    return normalized.map(headword => {
      const word = byHeadword.get(headword)
      if (!word) return { headword, exists: false, status: 'UNKNOWN', confidence: 0, tags: [] }
      const stored = word.knowledgeEntity?.states[0]
      const projected = statusFromCard(word.cards[0] ?? null)
      return {
        headword: word.headword,
        exists: true,
        status: stored?.status ?? projected.status,
        confidence: stored?.confidence ?? projected.confidence,
        memoryPolicy: stored?.memoryPolicy ?? 'FSRS',
        rank: word.rank,
        tags: word.tags.map(tag => ({ scheme: tag.scheme, level: tag.level, label: tag.label })),
      }
    })
  }

  async getVocabularyProfile() {
    const total = await prisma.word.count()
    const grouped = await prisma.personalKnowledgeState.groupBy({
      by: ['status'],
      where: {
        profileId: DEFAULT_PROFILE_ID,
        entity: { kind: 'word' },
      },
      _count: { _all: true },
    })

    const counts = Object.fromEntries(grouped.map(row => [row.status, row._count._all]))
    const known = (counts.KNOWN ?? 0) + (counts.MASTERED ?? 0)
    return {
      totalWords: total,
      trackedWords: grouped.reduce((sum, row) => sum + row._count._all, 0),
      knownWords: known,
      statusCounts: counts,
      knownRatio: total > 0 ? known / total : 0,
    }
  }
}
