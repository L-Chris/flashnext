import { Service } from 'typedi'
import { WordRepository, BANDS } from '../infrastructure/word.repository'
import { DeckRepository } from 'app/modules/decks/infrastructure/deck.repository'
import { prisma } from 'app/shared/prisma'

const deckNameForBand = (label: string, range: string) => `COCA ${label} (${range})`

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

  async getBands() {
    const stats = await Promise.all(
      BANDS.map(async meta => ({
        ...meta,
        wordCount: await this.wordRepository.countByBand(meta.band),
        cardCount: await this.wordRepository.countCardsByBand(meta.band),
      })),
    )
    return stats.filter(s => s.wordCount > 0)
  }

  async listWords(band: number, page: number, pageSize: number) {
    const words = await this.wordRepository.listByBand(band, (page - 1) * pageSize, pageSize)
    const total = await this.wordRepository.countByBand(band)
    return { words, total, page, pageSize }
  }

  async createDeckFromBand(band: number) {
    const meta = BANDS.find(b => b.band === band)
    if (!meta) throw new Error(`unknown band: ${band}`)

    const name = deckNameForBand(meta.label, meta.range)
    const existing = await prisma.deck.findFirst({ where: { name } })
    const deck = existing || (await this.deckRepository.create(name, meta.description ?? ''))

    const words = await this.wordRepository.findWordsWithoutCardInDeck(deck.id, band)
    if (words.length > 0) {
      await prisma.card.createMany({
        data: words.map(w => ({
          deckId: deck.id,
          wordId: w.id,
          front: w.headword,
          back: cardBack(w.phonetic, w.translation),
        })),
      })
    }

    const synced = await this.syncDeckCards(deck.id)

    return { deck, created: words.length, synced }
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
