import { Body, Get, HttpError, JsonController, Post } from 'routing-controllers'
import { Service } from 'typedi'
import { OptimizerService } from 'app/modules/fsrs/application/optimizer.service'
import { RebuildService } from 'app/modules/fsrs/application/rebuild.service'

class OptimizeBody {
  force?: boolean
  timeoutMs?: number
}

class RebuildBody {
  dryRun?: boolean
}

class ParamsBody {
  w?: number[]
  audit?: boolean
}

@JsonController('/fsrs')
@Service()
export class FsrsController {
  constructor(
    private optimizerService: OptimizerService,
    private rebuildService: RebuildService,
  ) {}

  @Get('/params')
  async params() {
    const data = await this.optimizerService.getStatus()
    return { data }
  }

  /** 手工设置 w；不传 w 即重置为 FSRS-6 官方默认值 */
  @Post('/params')
  async setParams(@Body() body: ParamsBody) {
    try {
      const data = await this.optimizerService.setParams(body?.w, Boolean(body?.audit))
      return { data }
    } catch (error: any) {
      throw new HttpError(400, error?.message || 'set params failed')
    }
  }

  /**
   * 用 fsrs-rs 官方优化器训练 w。
   * 护栏未通过时不会写入，返回 audit 说明原因；传 force=true 可强制落库。
   */
  @Post('/optimize')
  async optimize(@Body() body: OptimizeBody) {
    try {
      const data = this.optimizerService.start({
        force: Boolean(body?.force),
        timeoutMs: Number(body?.timeoutMs) || undefined,
      })
      return { data }
    } catch (error: any) {
      throw new HttpError(400, error?.message || 'optimize failed')
    }
  }

  @Get('/optimize')
  optimizeStatus() {
    const data = this.optimizerService.status()
    return { data }
  }

  /** 按当前 w 与 Anki 时间语义全量重放复习历史，重建记忆状态 + 回填 review_state + due 对齐日切点 */
  @Post('/rebuild')
  rebuild(@Body() body: RebuildBody) {
    const data = this.rebuildService.start(Boolean(body?.dryRun))
    return { data }
  }

  @Get('/rebuild')
  rebuildStatus() {
    const data = this.rebuildService.status()
    return { data }
  }
}
