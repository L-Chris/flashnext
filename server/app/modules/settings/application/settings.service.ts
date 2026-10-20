import { Service } from 'typedi'
import { HttpError } from 'routing-controllers'
import type { Prisma } from '@prisma/client'
import { prisma } from 'app/shared/prisma'
import { dueVisibleWhere } from 'app/modules/cards/infrastructure/due-filter'
import { ensureDeckConfig, ensureGlobalSettings } from '../../../../scripts/lib/deck-config'

export interface DeckSettings {
  deckId: number
  newPerDay: number
  reviewPerDay: number
  timezone: string
  rolloverHour: number
  version: number
  audioAutoplay: boolean
  showNewCardAnswerImmediately: boolean
  autoRevealAnswerSeconds: number | null
}

@Service()
export class SettingsService {
  async global() {
    const row = await ensureGlobalSettings(prisma)
    return { timezone: row.timezone as string, version: row.version }
  }

  async saveGlobal(body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'timezone')) throw new HttpError(400, '统一设置仅接受时区，学习限额请从牌组设置修改')
    const timezone = (body as { timezone?: unknown }).timezone
    if (typeof timezone !== 'string' || !timezone.trim()) throw new HttpError(400, '无效时区')
    try { new Intl.DateTimeFormat('en', { timeZone: timezone.trim() }) } catch { throw new HttpError(400, '无效时区') }
    return prisma.$transaction(async tx => {
      const current = await ensureGlobalSettings(tx)
      if (current.timezone === timezone.trim()) return { timezone: current.timezone, version: current.version }
      const row = await tx.appSetting.update({ where: { id: 1 }, data: { timezone: timezone.trim(), version: { increment: 1 } } })
      await tx.deckSetting.updateMany({ data: { timezone: row.timezone!, version: { increment: 1 } } })
      return { timezone: row.timezone!, version: row.version }
    })
  }

  async get(deckId: number): Promise<DeckSettings> {
    // Global updates synchronize every deck in one transaction. Read its stored
    // clock and version together without taking a write lock on ordinary reads.
    const row = await prisma.deckSetting.findUnique({ where: { deckId } })
    if (row) return row
    if (!await prisma.deck.findUnique({ where: { id: deckId } })) throw new HttpError(404, '牌组不存在')
    return (await ensureDeckConfig(prisma, deckId)).settings
  }

  async save(deckId: number, data: Partial<Pick<DeckSettings, 'newPerDay' | 'reviewPerDay' | 'timezone' | 'rolloverHour' | 'audioAutoplay' | 'showNewCardAnswerImmediately' | 'autoRevealAnswerSeconds'>>) {
    await this.get(deckId)
    for (const field of ['newPerDay', 'reviewPerDay', 'rolloverHour'] as const) {
      const value = data[field]
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > (field === 'rolloverHour' ? 23 : 100000))) throw new HttpError(400, `无效设置：${field}`)
    }
    for (const field of ['audioAutoplay', 'showNewCardAnswerImmediately'] as const) {
      if (data[field] !== undefined && typeof data[field] !== 'boolean') throw new HttpError(400, `无效设置：${field}`)
    }
    const delay = data.autoRevealAnswerSeconds
    if (delay !== undefined && delay !== null && (!Number.isInteger(delay) || delay < 1 || delay > 3600)) throw new HttpError(400, '自动显示答案的秒数必须是 1–3600 的整数，或 null 关闭')
    if (data.timezone !== undefined) {
      if (data.timezone !== (await this.global()).timezone) throw new HttpError(400, '时区请从统一设置修改')
    }
    const { timezone: _timezone, ...deckData } = data
    return prisma.deckSetting.update({ where: { deckId }, data: { ...deckData, version: { increment: 1 } } })
  }

  async visibleCardsWhere(now = new Date()): Promise<Prisma.CardWhereInput> {
    const decks = await prisma.deck.findMany({ select: { id: true } })
    const clauses = await Promise.all(decks.map(async d => ({ deckId: d.id, AND: [dueVisibleWhere(now, await this.get(d.id))] })))
    return { OR: clauses }
  }
}
