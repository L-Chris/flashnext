import { Service } from 'typedi'
import { HttpError } from 'routing-controllers'
import MarkdownIt from 'markdown-it'
import katex from 'katex'

export type ContentFormat = 'plain' | 'markdown_math'
export interface ContentDiagnostic { message: string; offset: number; line: number; column: number }
interface RenderEnv extends Record<PropertyKey, unknown> { source: string; cursor: number; formulas: number; errors: ContentDiagnostic[] }
const MAX_CONTENT = 100000
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const escapedAt = (s: string, i: number) => { let n = 0; while (i > 0 && s[--i] === '\\') n++; return n % 2 === 1 }
const closingAt = (s: string, delimiter: string, from: number) => {
  let pos = s.indexOf(delimiter, from)
  while (pos >= 0 && escapedAt(s, pos)) pos = s.indexOf(delimiter, pos + delimiter.length)
  return pos
}
const diagnostic = (env: RenderEnv, raw: string, message: string) => {
  const found = env.source.indexOf(raw, env.cursor)
  const offset = found >= 0 ? found : env.cursor
  env.cursor = offset + raw.length
  const lines = env.source.slice(0, offset).split('\n')
  env.errors.push({ message, offset, line: lines.length, column: lines[lines.length - 1].length + 1 })
}

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false })
// Audio is represented by structured attachments, never raw HTML or remote embeds.
markdown.disable('image')
markdown.inline.ruler.before('escape', 'card_math', (state, silent) => {
  const pos = state.pos
  const open = ['\\(', '\\[', '$$'].find(d => state.src.startsWith(d, pos))
  if (!open) return false
  const close = open === '\\(' ? '\\)' : open === '\\[' ? '\\]' : '$$'
  const end = closingAt(state.src, close, pos + open.length)
  if (silent) return end >= 0
  const stop = end >= 0 ? end + close.length : state.posMax
  const token = state.push('card_math', 'math', 0)
  token.content = state.src.slice(pos + open.length, end >= 0 ? end : stop)
  token.meta = { raw: state.src.slice(pos, stop), display: open !== '\\(', unclosed: end < 0 }
  state.pos = stop
  return true
})
markdown.block.ruler.before('paragraph', 'card_math_block', (state, startLine, endLine, silent) => {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const open = ['$$', '\\['].find(d => state.src.startsWith(d, start))
  if (!open) return false
  const close = open === '$$' ? '$$' : '\\]'
  const found = closingAt(state.src, close, start + open.length)
  const end = found >= 0 ? found + close.length : state.src.length
  const lineEnd = state.src.indexOf('\n', end)
  if (found >= 0 && state.src.slice(end, lineEnd < 0 ? state.src.length : lineEnd).trim()) return false
  if (silent) return true
  let nextLine = startLine + 1
  while (nextLine < endLine && state.bMarks[nextLine] < end) nextLine++
  const token = state.push('card_math', 'math', 0)
  token.block = true
  token.map = [startLine, nextLine]
  token.content = state.src.slice(start + open.length, found >= 0 ? found : end)
  token.meta = { raw: state.src.slice(start, end), display: true, unclosed: found < 0 }
  state.line = nextLine
  return true
}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
markdown.renderer.rules.card_math = (tokens, idx, _options, rawEnv) => {
  const env = rawEnv as unknown as RenderEnv
  const token = tokens[idx]
  const { raw, display, unclosed } = token.meta as { raw: string; display: boolean; unclosed: boolean }
  try {
    env.formulas++
    if (unclosed) throw new Error('公式缺少结束分隔符')
    if (!token.content.trim()) throw new Error('公式不能为空')
    if (token.content.length > 4000) throw new Error('单个公式最多 4000 个字符')
    if (env.formulas > 100) throw new Error('单面最多 100 个公式')
    if (/\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData)\b/.test(token.content)) throw new Error('公式不支持外部资源或 HTML 扩展命令')
    const html = katex.renderToString(token.content, { displayMode: display, output: 'htmlAndMathml',
      throwOnError: true, trust: false, strict: 'error', maxExpand: 1000, maxSize: 20, macros: {} })
    // Advance source position for diagnostics of subsequent expressions, including duplicates.
    const found = env.source.indexOf(raw, env.cursor)
    if (found >= 0) env.cursor = found + raw.length
    return html + (token.block ? '\n' : '')
  } catch (error) {
    diagnostic(env, raw, String(error?.message || error))
    return `<span class="math-error">${escapeHtml(raw)}</span>` + (token.block ? '\n' : '')
  }
}

@Service()
export class ContentService {
  format(value: unknown): ContentFormat {
    if (value !== 'plain' && value !== 'markdown_math') throw new HttpError(400, 'contentFormat 必须是 plain 或 markdown_math')
    return value
  }

  text(value: unknown, field: string, required = false): string {
    if (typeof value !== 'string' || value.length > MAX_CONTENT || (required && !value.trim())) throw new HttpError(400, `${field} 必须是${required ? '非空' : ''}文本，且不超过 ${MAX_CONTENT} 个字符`)
    return value
  }

  render(source: string, format: ContentFormat) {
    const env: RenderEnv = { source, cursor: 0, formulas: 0, errors: [] }
    const html = format === 'plain' ? escapeHtml(source).replace(/\r?\n/g, '<br>\n') : markdown.render(source, env)
    if (html.length > 2 * 1024 * 1024) {
      diagnostic(env, '', '渲染结果超过 2 MiB，请精简内容')
      return { html: '', errors: env.errors }
    }
    return { html, errors: env.errors }
  }

  preview(body: { contentFormat?: unknown; front?: unknown; back?: unknown }) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '预览内容必须为 JSON 对象')
    const format = this.format(body.contentFormat === undefined ? 'markdown_math' : body.contentFormat)
    const front = this.render(this.text(body.front === undefined ? '' : body.front, 'front'), format)
    const back = this.render(this.text(body.back === undefined ? '' : body.back, 'back'), format)
    return { contentFormat: format, front, back, valid: !front.errors.length && !back.errors.length,
      renderer: { name: 'katex', version: katex.version, cssUrl: '/api/content/assets/katex.min.css' } }
  }

  validateCard(front: string, back: string, format: ContentFormat) {
    this.text(front, 'front', true); this.text(back, 'back', true)
    if (format === 'plain') return
    const result = this.preview({ front, back, contentFormat: format })
    if (!result.valid) {
      const first = result.front.errors.length ? { field: 'front', ...result.front.errors[0] } : { field: 'back', ...result.back.errors[0] }
      throw new HttpError(422, `${first.field} 第 ${first.line} 行第 ${first.column} 列：${first.message}`)
    }
  }
}
