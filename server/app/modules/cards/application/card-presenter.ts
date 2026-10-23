import { Service } from 'typedi'
import { SettingsService, type DeckSettings } from 'app/modules/settings/application/settings.service'
import { mediaView } from 'app/modules/media/application/media.service'

export const reviewOptionsOf = (settings: DeckSettings) => ({
  audioAutoplay: settings.audioAutoplay,
  showNewCardAnswerImmediately: settings.showNewCardAnswerImmediately,
  autoRevealAnswerSeconds: settings.autoRevealAnswerSeconds,
  settingsVersion: settings.version,
})

@Service()
export class CardPresenter {
  constructor(private settingsService: SettingsService) {}
  async cards(cards: any[], knownSettings?: DeckSettings) {
    const settings = new Map<number, DeckSettings>()
    if (knownSettings) settings.set(knownSettings.deckId, knownSettings)
    await Promise.all([...new Set<number>(cards.map(c => c.deckId))].filter(id => !settings.has(id)).map(async id => settings.set(id, await this.settingsService.get(id))))
    return cards.map(card => {
      const { knowledgeEntity, ...view } = card
      let metadata: Record<string, any> = {}
      try { metadata = JSON.parse(knowledgeEntity?.metadata || '{}') || {} } catch { /* old metadata remains readable */ }
      const clock = settings.get(card.deckId)!
      const isNew = card.state === 0 && card.reps === 0
      const answerRevealAfterMs = isNew && clock.showNewCardAnswerImmediately ? 0 : clock.autoRevealAnswerSeconds === null ? null : clock.autoRevealAnswerSeconds * 1000
      return { ...view,
        knowledge: knowledgeEntity ? { id: knowledgeEntity.id, key: knowledgeEntity.canonicalKey,
          title: knowledgeEntity.title, tags: knowledgeEntity.tags || [],
          prerequisites: metadata.prerequisites || [], sources: metadata.sources || [] } : null,
        media: (card.media || []).map(link => ({ mediaId: link.mediaId, side: link.side, position: link.position, ...mediaView(link.asset) })),
        presentation: { audioAutoplay: clock.audioAutoplay, answerRevealAfterMs, settingsVersion: clock.version },
      }
    })
  }
}
