import { Get, Post, Delete, JsonController, Body, Param, HttpError } from 'routing-controllers'
import { Service } from 'typedi'
import { CardService } from 'app/modules/cards/application/card.service'
import { Grade } from 'app/modules/cards/application/sm2.algorithm'

class CreateCardBody {
  front: string
  back: string
}

class ReviewCardBody {
  grade: number
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

  @Get('/due')
  async due(@Param('deckId') deckId: number) {
    const data = await this.cardService.listDueCards(Number(deckId))
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
    if (body.grade < 0 || body.grade > 5) throw new HttpError(400, 'grade must be 0-5')
    const data = await this.cardService.reviewCard(Number(id), body.grade as Grade)
    if (!data) throw new HttpError(404, 'card not found')
    return { data }
  }
}
