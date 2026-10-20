import { Body, Get, JsonController, Param, Post } from 'routing-controllers'
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
export class GlobalSettingsController {
  constructor(private settingsService: SettingsService) {}
  @Get('/') async get() { return { data: await this.settingsService.global() } }
  @Post('/') async save(@Body() body: unknown) { return { data: await this.settingsService.saveGlobal(body) } }
}
