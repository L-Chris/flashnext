import { Body, Get, JsonController, Post } from 'routing-controllers'
import { Service } from 'typedi'
import { SettingsService } from 'app/modules/settings/application/settings.service'

class SettingsBody {
  newPerDay?: number
  reviewPerDay?: number
}

@JsonController('/settings')
@Service()
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get('/')
  async get() {
    const data = await this.settingsService.get()
    return { data }
  }

  @Post('/')
  async save(@Body() body: SettingsBody) {
    const payload: { newPerDay?: number; reviewPerDay?: number } = {}
    const n = Number(body?.newPerDay)
    const r = Number(body?.reviewPerDay)
    if (Number.isFinite(n)) payload.newPerDay = n
    if (Number.isFinite(r)) payload.reviewPerDay = r
    const data = await this.settingsService.save(payload)
    return { data }
  }
}
