import { Get, Post, Delete, JsonController, Body, Param, HttpError } from 'routing-controllers'
import { Service } from 'typedi'
import { CardService } from 'app/modules/cards/application/card.service'

class CreateCardBody {
  front: string
  back: string
}

class ReviewCardBody {
  rating: number
  durationMs?: number
}

@JsonController('/decks/:deckId/cards')
@Service()
export class DeckCardController {
  constructor(private cardService: CardService) {}

  @Get('/')
  async list(@Param('deckId') deckId: number) {
    const data = await this.cardService.listCards(Number(deckId))
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
    if (!body.front || !body.back) throw new HttpError(400, 'front and back required')
    const data = await this.cardService.createCard(Number(deckId), body.front, body.back)
    return { data }
  }
}

@JsonController('/cards')
@Service()
export class CardController {
  constructor(private cardService: CardService) {}

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
