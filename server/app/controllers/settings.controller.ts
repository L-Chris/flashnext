import { Body, Get, HttpError, JsonController, Param, Post } from 'routing-controllers'
import { Service } from 'typedi'
import { SettingsService, type DeckSettings } from 'app/modules/settings/application/settings.service'

import { deckIdOf } from 'app/shared/deck-id'

@JsonController('/decks/:deckId/settings')
@Service()
export class DeckSettingsController {
  constructor(private settingsService: SettingsService) {}
  @Get('/')
  async get(@Param('deckId') deckId: string) { return { data: await this.settingsService.get(deckIdOf(deckId)) } }
  @Post('/')
  async save(@Param('deckId') deckId: string, @Body() body: Partial<DeckSettings>) {
    const data: Partial<DeckSettings> = {}
    for (const key of ['newPerDay', 'reviewPerDay', 'timezone', 'rolloverHour', 'audioAutoplay', 'showNewCardAnswerImmediately', 'autoRevealAnswerSeconds'] as const) if (body?.[key] !== undefined) (data as any)[key] = body[key]
    return { data: await this.settingsService.save(deckIdOf(deckId), data) }
  }
}

@JsonController('/settings')
@Service()
export class LegacySettingsController {
  @Get('/') get() { throw new HttpError(400, '请从牌组的设置入口操作') }
  @Post('/') save() { throw new HttpError(400, '必须指定牌组，禁止修改全局学习设置') }
}
