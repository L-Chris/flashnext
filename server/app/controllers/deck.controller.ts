import { Get, Post, Delete, JsonController, Body, Param } from 'routing-controllers'
import { Service } from 'typedi'
import { DeckService } from 'app/modules/decks/application/deck.service'
import { deckIdOf } from 'app/shared/deck-id'

class CreateDeckBody {
  name: string
  description?: string
}

@JsonController('/decks')
@Service()
export class DeckController {
  constructor(private deckService: DeckService) {}

  @Get('/')
  async list() {
    const data = await this.deckService.listDecks()
    return { data }
  }

  @Post('/')
  async create(@Body() body: CreateDeckBody) {
    const data = await this.deckService.createDeck(body.name, body.description || '')
    return { data }
  }

  @Get('/:id/topics')
  async topics(@Param('id') id: string) {
    return { data: await this.deckService.listTopics(deckIdOf(id)) }
  }

  @Delete('/:id')
  async remove(@Param('id') id: number) {
    await this.deckService.deleteDeck(Number(id))
    return { data: true }
  }
}
