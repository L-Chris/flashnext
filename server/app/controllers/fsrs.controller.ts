import { Get, Post, JsonController, HttpError } from 'routing-controllers'
import { Service } from 'typedi'
import { OptimizerService } from 'app/modules/fsrs/application/optimizer.service'

@JsonController('/fsrs')
@Service()
export class FsrsController {
  constructor(private optimizerService: OptimizerService) {}

  @Get('/params')
  async params() {
    const data = await this.optimizerService.getStatus()
    return { data }
  }

  @Post('/optimize')
  async optimize() {
    try {
      const data = await this.optimizerService.optimize()
      return { data }
    } catch (error: any) {
      throw new HttpError(400, error?.message || 'optimize failed')
    }
  }
}
