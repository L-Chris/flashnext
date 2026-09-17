import { Get, JsonController, Param, QueryParam } from 'routing-controllers'
import { Service } from 'typedi'
import { SynonymsService } from 'app/modules/synonyms/application/synonyms.service'

@JsonController('/synonyms')
@Service()
export class SynonymsController {
  constructor(private synonymsService: SynonymsService) {}

  @Get('/groups')
  async groups(
    @QueryParam('page') page?: string,
    @QueryParam('pageSize') pageSize?: string,
    @QueryParam('q') q?: string,
    @QueryParam('pos') pos?: string,
  ) {
    const size = [20, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 50
    const data = await this.synonymsService.groups({
      page: Math.max(1, Number(page) || 1),
      pageSize: size,
      q: q || '',
      pos: pos || '',
    })
    return { data }
  }

  @Get('/word/:headword')
  async word(@Param('headword') headword: string) {
    const data = await this.synonymsService.wordGroups(headword)
    return { data }
  }
}
