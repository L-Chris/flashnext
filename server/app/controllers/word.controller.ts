import { Get, Post, JsonController, Body, QueryParam, HttpError } from 'routing-controllers'
import { Service } from 'typedi'
import { WordService } from 'app/modules/words/application/word.service'

class EnsureCardsBody {
  scheme?: string
  level?: number
}

@JsonController('/words')
@Service()
export class WordController {
  constructor(private wordService: WordService) {}

  @Get('/tags')
  async tags() {
    const data = await this.wordService.getTags()
    return { data }
  }

  @Get('/coverage')
  async coverage(@QueryParam('scheme') scheme: string) {
    if (!scheme) throw new HttpError(400, 'scheme required')
    const data = await this.wordService.getCoverage(scheme)
    return { data }
  }

  @Post('/cards/ensure')
  async ensure(@Body() body: EnsureCardsBody) {
    const level = body.level === undefined || body.level === null ? undefined : Number(body.level)
    const data = await this.wordService.ensureCards(body.scheme || undefined, level)
    return { data }
  }
}
