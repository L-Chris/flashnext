import { Ctx, Delete, Get, Head, JsonController, Param, Post } from 'routing-controllers'
import { Service } from 'typedi'
import type { Context } from 'koa'
import { MediaService } from 'app/modules/media/application/media.service'

@JsonController('/media')
@Service()
export class MediaController {
  constructor(private mediaService: MediaService) {}
  @Post('/')
  async upload(@Ctx() ctx: Context) { return { data: await this.mediaService.upload(ctx.req) } }
  @Get('/:id/content')
  async content(@Param('id') id: string, @Ctx() ctx: Context) { return this.mediaService.content(id, ctx) }
  @Head('/:id/content')
  async head(@Param('id') id: string, @Ctx() ctx: Context) { return this.mediaService.content(id, ctx) }
  @Delete('/:id')
  async remove(@Param('id') id: string) { return { data: await this.mediaService.remove(id) } }
}
