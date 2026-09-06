import { Body, Get, JsonController, Post } from 'routing-controllers'
import { Service } from 'typedi'
import { KnowledgeService } from 'app/modules/knowledge/application/knowledge.service'

class VocabularyCheckBody {
  words!: string[]
}

@JsonController('/knowledge')
@Service()
export class KnowledgeController {
  constructor(private knowledgeService: KnowledgeService) {}

  @Get('/profile')
  async profile() {
    return { data: await this.knowledgeService.getProfile() }
  }

  @Post('/sync/words')
  async syncWords() {
    return { data: await this.knowledgeService.syncWords() }
  }

  @Post('/vocabulary/check')
  async checkVocabulary(@Body() body: VocabularyCheckBody) {
    return { data: await this.knowledgeService.checkVocabulary(body.words || []) }
  }

  @Get('/vocabulary/profile')
  async vocabularyProfile() {
    return { data: await this.knowledgeService.getVocabularyProfile() }
  }
}
