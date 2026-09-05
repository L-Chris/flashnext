import { Get, Post, JsonController, Body, Param, QueryParam, HttpError } from 'routing-controllers'
import { Service } from 'typedi'
import { WordService } from 'app/modules/words/application/word.service'

class CreateDeckFromBandBody {
  band: number
}

@JsonController('/words')
@Service()
export class WordController {
  constructor(private wordService: WordService) {}

  @Get('/bands')
  async bands() {
    const data = await this.wordService.getBands()
    return { data }
  }

  @Get('/')
  async list(
    @QueryParam('band') band: number,
    @QueryParam('page') page?: number,
    @QueryParam('pageSize') pageSize?: number,
  ) {
    if (!band || band < 1 || band > 5) throw new HttpError(400, 'band must be 1-5')
    const data = await this.wordService.listWords(Number(band), Number(page) || 1, Number(pageSize) || 50)
    return { data }
  }

  @Post('/decks/from-band')
  async fromBand(@Body() body: CreateDeckFromBandBody) {
    const band = Number(body.band)
    if (!band || band < 1 || band > 5) throw new HttpError(400, 'band must be 1-5')
    const data = await this.wordService.createDeckFromBand(band)
    return { data }
  }
}
