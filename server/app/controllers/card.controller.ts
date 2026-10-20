import { Get, Post, Patch, Delete, JsonController, Body, Param, QueryParam, HttpError } from 'routing-controllers'
import { deckIdOf } from 'app/shared/deck-id'
import { Service } from 'typedi'
import { CardService, normalizeCardPageQuery } from 'app/modules/cards/application/card.service'

class CreateCardBody {
  front: string
  back: string
  contentFormat?: string
  media?: Array<{ mediaId: string; side: string; position: number }>
}

class ReviewCardBody {
  rating: number
  durationMs?: number
}

@JsonController('/decks/:deckId/cards')
@Service()
export class DeckCardController {
  constructor(private cardService: CardService) {}

  /** 牌组详情表格：?sort=&dir=&page=&pageSize=，sort 白名单见 CARD_SORT_KEYS */
  @Get('/')
  async list(
    @Param('deckId') deckId: number,
    @QueryParam('sort') sort?: string,
    @QueryParam('dir') dir?: string,
    @QueryParam('page') page?: string,
    @QueryParam('pageSize') pageSize?: string,
    @QueryParam('q') q?: string,
  ) {
    const data = await this.cardService.listCardsPaged(
      Number(deckId),
      normalizeCardPageQuery({ sort, dir, page, pageSize, q }),
    )
    return { data }
  }

  /** 复习队列：当天可见 + learn-ahead + 日限额 + 按 retrievability 排序 */
  @Get('/due')
  async due(@Param('deckId') deckId: number) {
    const data = await this.cardService.queue(Number(deckId))
    return { data }
  }

  @Post('/')
  async create(@Param('deckId') deckId: number, @Body() body: CreateCardBody) {
    const data = await this.cardService.createCard(deckIdOf(String(deckId)), body)
    return { data }
  }
}

@JsonController('/cards')
@Service()
export class CardController {
  constructor(private cardService: CardService) {}

  @Get('/:id')
  async get(@Param('id') id: string) { return { data: await this.cardService.getCard(deckIdOf(id)) } }

  @Patch('/:id')
  async edit(@Param('id') id: string, @Body() body: object) { return { data: await this.cardService.editCard(deckIdOf(id), body) } }

  @Delete('/:id')
  async remove(@Param('id') id: number) {
    await this.cardService.deleteCard(Number(id))
    return { data: true }
  }

  @Post('/:id/review')
  async review(@Param('id') id: number, @Body() body: ReviewCardBody) {
    const rating = Number(body.rating)
    if (rating < 1 || rating > 4) {
      throw new HttpError(400, 'rating must be 1-4')
    }
    const durationMs = Number(body.durationMs) || 0
    const data = await this.cardService.reviewCard(Number(id), rating as 1 | 2 | 3 | 4, durationMs)
    if (!data) throw new HttpError(404, 'card not found')
    return { data }
  }

  /** 撤销这张卡最近一次评分 */
  @Post('/:id/undo')
  async undo(@Param('id') id: number) {
    const data = await this.cardService.undoCard(Number(id))
    if (!data) throw new HttpError(404, 'card not found or no review to undo')
    return { data }
  }
}
