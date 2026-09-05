import { Service } from 'typedi'
import { WordRepository } from '../infrastructure/word.repository'
import { DeckRepository } from 'app/modules/decks/infrastructure/deck.repository'
import { TAG_SCHEMES, SINGLE_DECK_NAME } from '../infrastructure/tag.registry'
import { prisma } from 'app/shared/prisma'

const cardBack = (phonetic: string, translation: string) => {
  const parts: string[] = []
  if (phonetic) parts.push(`/${phonetic}/`)
  parts.push(translation)
  return parts.join('\n')
}

@Service()
export class WordService {
  constructor(
    private wordRepository: WordRepository,
    private deckRepository: DeckRepository,
  ) {}

  async getTags() {
    const schemes = await Promise.all(
      TAG_SCHEMES.map(async meta => ({
        scheme: meta.scheme,
        name: meta.name,
        levels: meta.levels,
        taggedCount: await this.wordRepository.countTagged(meta.scheme),
      })),
    )
    return schemes
  }

  async getCoverage(scheme: string) {
    const meta = TAG_SCHEMES.find(s => s.scheme === scheme)
    if (!meta) throw new Error(`unknown scheme: ${scheme}`)

    const rows = await Promise.all(
      meta.levels.map(async level => {
        const [wordTotal, cardCount, studiedCount, dueCount] = await Promise.all([
          this.wordRepository.countTagged(scheme, level.level),
          this.wordRepository.countTaggedWithCard(scheme, level.level),
          this.wordRepository.countTaggedStudied(scheme, level.level),
          this.wordRepository.countTaggedDue(scheme, level.level),
        ])
        return {
          level: level.level,
          label: level.label,
          description: level.description,
          wordTotal,
          cardCount,
          studiedCount,
          dueCount,
          coverage: wordTotal > 0 ? cardCount / wordTotal : 0,
        }
      }),
    )

    const [wordTotal, cardCount, studiedCount, dueCount] = await Promise.all([
      this.wordRepository.countUntagged(scheme),
      this.wordRepository.countUntaggedWithCard(scheme),
      this.wordRepository.countUntaggedStudied(scheme),
      this.wordRepository.countUntaggedDue(scheme),
    ])
    rows.push({
      level: null,
      label: '未收录',
      description: `不在${meta.name}分级内`,
      wordTotal,
      cardCount,
      studiedCount,
      dueCount,
      coverage: wordTotal > 0 ? cardCount / wordTotal : 0,
    })

    return rows
  }

  async ensureCards(scheme?: string, level?: number) {
    const deck = await this.ensureSingleDeck()

    const words = scheme
      ? await this.wordRepository.findTaggedWithoutCard(scheme, level)
      : await this.wordRepository.findAllWithoutCard()

    if (words.length > 0) {
      const chunkSize = 500
      for (let i = 0; i < words.length; i += chunkSize) {
        const chunk = words.slice(i, i + chunkSize)
        await prisma.card.createMany({
          data: chunk.map(w => ({
            deckId: deck.id,
            wordId: w.id,
            front: w.headword,
            back: cardBack(w.phonetic, w.translation),
          })),
        })
      }
    }

    const synced = await this.syncDeckCards(deck.id)

    return { deck, created: words.length, synced }
  }

  async ensureSingleDeck() {
    const existing = await prisma.deck.findFirst({ where: { name: SINGLE_DECK_NAME } })
    if (existing) return existing
    return this.deckRepository.create(SINGLE_DECK_NAME, '全部单词卡片')
  }

  private async syncDeckCards(deckId: number) {
    const cards = await prisma.card.findMany({
      where: { deckId, wordId: { not: null } },
      include: { word: true },
    })

    const stale = cards.filter(
      c =>
        c.word &&
        (c.front !== c.word.headword ||
          c.back !== cardBack(c.word.phonetic, c.word.translation)),
    )

    if (stale.length > 0) {
      await prisma.$transaction(
        stale.map(c =>
          prisma.card.update({
            where: { id: c.id },
            data: {
              front: c.word!.headword,
              back: cardBack(c.word!.phonetic, c.word!.translation),
            },
          }),
        ),
      )
    }

    return stale.length
  }
}
