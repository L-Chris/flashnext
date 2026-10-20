import { Body, Get, HttpError, JsonController, Param, Post } from 'routing-controllers'
import { Service } from 'typedi'
import { OptimizerService } from 'app/modules/fsrs/application/optimizer.service'
import { RebuildService } from 'app/modules/fsrs/application/rebuild.service'
import { SettingsService } from 'app/modules/settings/application/settings.service'
import { deckIdOf } from 'app/shared/deck-id'

@JsonController('/decks/:deckId/fsrs')
@Service()
export class DeckFsrsController {
  constructor(private optimizerService: OptimizerService, private rebuildService: RebuildService, private settingsService: SettingsService) {}
  @Get('/params')
  async params(@Param('deckId') id: string) { return { data: await this.optimizerService.getStatus(deckIdOf(id)) } }
  @Post('/params')
  async setParams(@Param('deckId') id: string, @Body() body: { w?: number[]; audit?: boolean }) {
    return { data: await this.optimizerService.setParams(deckIdOf(id), body?.w, Boolean(body?.audit)) }
  }
  @Post('/optimize')
  async optimize(@Param('deckId') id: string, @Body() body: { force?: boolean; timeoutMs?: number }) {
    return { data: await this.optimizerService.start(deckIdOf(id), { force: Boolean(body?.force), timeoutMs: Number(body?.timeoutMs) || undefined }) }
  }
  @Get('/optimize')
  async optimizeStatus(@Param('deckId') id: string) {
    const deckId = deckIdOf(id); await this.settingsService.get(deckId)
    return { data: this.optimizerService.status(deckId) }
  }
  @Post('/rebuild')
  async rebuild(@Param('deckId') id: string, @Body() body: { dryRun?: boolean }) {
    return { data: await this.rebuildService.start(deckIdOf(id), Boolean(body?.dryRun)) }
  }
  @Get('/rebuild')
  async rebuildStatus(@Param('deckId') id: string) {
    const deckId = deckIdOf(id); await this.settingsService.get(deckId)
    return { data: this.rebuildService.status(deckId) }
  }
}

@JsonController('/fsrs')
@Service()
export class LegacyFsrsController {
  @Get('/params') params() { throw new HttpError(400, '必须指定牌组') }
  @Post('/params') setParams() { throw new HttpError(400, '必须指定牌组') }
  @Get('/optimize') optimizeStatus() { throw new HttpError(400, '必须指定牌组') }
  @Post('/optimize') optimize() { throw new HttpError(400, '必须指定牌组') }
  @Get('/rebuild') rebuildStatus() { throw new HttpError(400, '必须指定牌组') }
  @Post('/rebuild') rebuild() { throw new HttpError(400, '必须指定牌组，禁止全库重建') }
}
