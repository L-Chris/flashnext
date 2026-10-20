import { Service } from 'typedi'
import type { Prisma } from '@prisma/client'
import { HttpError } from 'routing-controllers'
import { prisma } from 'app/shared/prisma'
import { ContentService } from 'app/modules/content/application/content.service'
import { SettingsService } from 'app/modules/settings/application/settings.service'
import { CardRepository } from '../infrastructure/card.repository'
import { CardPresenter } from './card-presenter'

interface Attachment { mediaId: string; side: 'front' | 'back'; position: number }
export interface CardContentBody { front?: string; back?: string; contentFormat?: string; media?: Attachment[] }

@Service()
export class CardEditor {
  constructor(private contentService: ContentService, private settingsService: SettingsService,
    private cardRepository: CardRepository, private presenter: CardPresenter) {}

  private body(value: unknown): CardContentBody {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '卡片内容必须为 JSON 对象')
    const allowed = ['front', 'back', 'contentFormat', 'media']
    if (Object.keys(value).some(key => !allowed.includes(key))) throw new HttpError(400, '仅允许编辑 front、back、contentFormat 和 media')
    if (!Object.keys(value).length) throw new HttpError(400, '请提供需要修改的卡片内容')
    return value
  }

  private attachments(value: unknown): Attachment[] {
    if (!Array.isArray(value) || value.length > 20) throw new HttpError(400, 'media 必须为数组，单张卡片最多关联 20 个音频')
    const slots = new Set<string>(), used = new Set<string>()
    return value.map(item => {
      if (!item || typeof item !== 'object' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.mediaId) || !['front', 'back'].includes(item.side) || !Number.isSafeInteger(item.position) || item.position < 0 || item.position > 1000) throw new HttpError(400, '音频关联需要有效的 mediaId、front/back 和 0–1000 的整数 position')
      const slot = `${item.side}:${item.position}`, unique = `${item.side}:${item.mediaId}`
      if (slots.has(slot) || used.has(unique)) throw new HttpError(400, '同一面不能有重复音频或重复播放顺序')
      slots.add(slot); used.add(unique)
      return { mediaId: item.mediaId, side: item.side, position: item.position }
    })
  }

  async get(id: number) {
    const cards = await this.cardRepository.listByIds([id])
    if (!cards.length) throw new HttpError(404, '卡片不存在')
    return (await this.presenter.cards(cards))[0]
  }

  async create(deckId: number, raw: unknown) {
    await this.settingsService.get(deckId)
    const body = this.body(raw)
    const front = this.contentService.text(body.front, 'front', true)
    const back = this.contentService.text(body.back, 'back', true)
    const format = this.contentService.format(body.contentFormat === undefined ? 'plain' : body.contentFormat)
    this.contentService.validateCard(front, back, format)
    const media = body.media === undefined ? [] : this.attachments(body.media)
    const created = await prisma.$transaction(async tx => {
      await this.checkMedia(tx, media)
      return tx.card.create({ data: { deckId, front, back, contentFormat: format, media: { create: media } } })
    })
    return this.get(created.id)
  }

  async update(id: number, raw: unknown) {
    const body = this.body(raw)
    const media = body.media === undefined ? undefined : this.attachments(body.media)
    await prisma.$transaction(async tx => {
      const current = await tx.card.findUnique({ where: { id } })
      if (!current) throw new HttpError(404, '卡片不存在')
      const front = body.front === undefined ? current.front : this.contentService.text(body.front, 'front', true)
      const back = body.back === undefined ? current.back : this.contentService.text(body.back, 'back', true)
      const format = this.contentService.format(body.contentFormat === undefined ? current.contentFormat : body.contentFormat)
      this.contentService.validateCard(front, back, format)
      if (media !== undefined) {
        await this.checkMedia(tx, media)
        await tx.cardMedia.deleteMany({ where: { cardId: id } })
        if (media.length) await tx.cardMedia.createMany({ data: media.map(link => ({ ...link, cardId: id })) })
      }
      await tx.card.update({ where: { id }, data: { front, back, contentFormat: format } })
    })
    return this.get(id)
  }

  private async checkMedia(tx: Prisma.TransactionClient, media: Attachment[]) {
    const ids = [...new Set(media.map(link => link.mediaId))]
    if (!ids.length) return
    if (await tx.mediaAsset.count({ where: { id: { in: ids } } }) !== ids.length) throw new HttpError(404, '关联的音频不存在')
  }
}
