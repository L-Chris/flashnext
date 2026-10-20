import { Body, Ctx, Get, HttpError, JsonController, Param, Post } from 'routing-controllers'
import { Service } from 'typedi'
import type { Context } from 'koa'
import fs from 'node:fs'
import path from 'node:path'
import { ContentService } from 'app/modules/content/application/content.service'

const assetsRoot = path.dirname(require.resolve('katex'))
@JsonController('/content')
@Service()
export class ContentController {
  constructor(private contentService: ContentService) {}
  @Post('/preview')
  preview(@Body() body: { contentFormat?: unknown; front?: unknown; back?: unknown }) { return { data: this.contentService.preview(body) } }

  private asset(ctx: Context, filename: string, type: string) {
    const file = path.join(assetsRoot, filename)
    if (!fs.existsSync(file)) throw new HttpError(404, '资源不存在')
    ctx.type = type
    ctx.set('Cache-Control', 'public, max-age=86400')
    ctx.set('X-Content-Type-Options', 'nosniff')
    ctx.body = fs.createReadStream(file)
    return ctx
  }
  @Get('/assets/katex.min.css')
  css(@Ctx() ctx: Context) { return this.asset(ctx, 'katex.min.css', 'text/css') }
  @Get('/assets/fonts/:filename')
  font(@Ctx() ctx: Context, @Param('filename') name: string) {
    if (!/^KaTeX_[a-zA-Z0-9_-]+\.(woff2|woff|ttf)$/.test(name)) throw new HttpError(404, '字体不存在')
    const mime = name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.woff') ? 'font/woff' : 'font/ttf'
    return this.asset(ctx, `fonts/${name}`, mime)
  }
}
