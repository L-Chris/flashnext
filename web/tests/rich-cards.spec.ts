import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

const decks: number[] = [], assets = new Set<string>()
const content = (front: string, back = '答案') => ({ front, back, contentFormat: 'plain', media: [] })
async function api(request: APIRequestContext, path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST') {
  const response = await request.fetch(`/api${path}`, { method, data })
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy()
  return (await response.json()).data
}
async function deck(request: APIRequestContext, settings: Record<string, unknown> = {}) {
  const result = await api(request, '/decks', { name: `Web测试-${Date.now()}-${decks.length}`, description: '临时浏览器测试' })
  decks.push(result.id)
  if (Object.keys(settings).length) await api(request, `/decks/${result.id}/settings`, settings)
  return result
}
function wave(seconds = 1, seed = 0) {
  const samples = Math.round(8000 * seconds), data = Buffer.alloc(44 + samples * 2)
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34)
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((i + seed) * .1) * 150), 44 + i * 2)
  return data
}
async function audio(request: APIRequestContext, name: string, seconds = 1) {
  const response = await request.post('/api/media', { multipart: { file: { name, mimeType: 'audio/wav', buffer: wave(seconds, assets.size + 1) } } })
  expect(response.ok()).toBeTruthy(); const result = (await response.json()).data; assets.add(result.id); return result
}
async function review(page: Page, id: number) {
  await page.goto(`/#/deck/${id}`)
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect(page.getByTestId('review-card')).toBeVisible()
}
async function stopTime(page: Page) { await page.clock.pauseAt(await page.evaluate(() => Date.now() + 200)) }

test.beforeAll(async ({ baseURL }) => {
  const url = new URL(baseURL!)
  if (process.env.FLASHNEXT_ALLOW_TEST_WRITES !== '1' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.port === '9000') throw new Error('测试会增删卡片：只允许显式授权的本地数据库副本服务，禁止指向生产')
})
test.afterAll(async ({ request }) => {
  for (const id of decks) {
    const response = await request.get(`/api/decks/${id}/cards?pageSize=200`)
    if (response.ok()) {
      for (let card of (await response.json()).data.cards) {
        while (card.reps > 0) {
          const undone = await request.post(`/api/cards/${card.id}/undo`)
          if (!undone.ok()) break
          card = (await undone.json()).data
        }
      }
    }
    await request.delete(`/api/decks/${id}`)
  }
  for (const id of assets) await request.delete(`/api/media/${id}`)
})
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error })
  page.on('response', async response => { if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/media' && response.ok()) { const asset = (await response.json()).data; assets.add(asset.id) } })
})

test('牌组配置保存、关闭倒计时和相互隔离', async ({ page, request }) => {
  const first = await deck(request), second = await deck(request)
  await page.goto('/')
  await page.getByRole('button', { name: `${first.name}设置`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('自动显示答案等待秒数')).toHaveValue('10')
  await dialog.getByLabel('自动播放卡片音频', { exact: true }).check()
  await dialog.getByLabel('未学习的新卡直接显示答案', { exact: true }).check()
  await dialog.getByLabel('自动显示答案', { exact: true }).uncheck()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('已保存')
  await page.keyboard.press('Escape')
  const saved = await api(request, `/decks/${first.id}/settings`)
  expect(saved.audioAutoplay).toBe(true); expect(saved.showNewCardAnswerImmediately).toBe(true); expect(saved.autoRevealAnswerSeconds).toBeNull()
  await page.getByRole('button', { name: `${second.name}设置`, exact: true }).click()
  await expect(dialog.getByLabel('自动播放卡片音频', { exact: true })).not.toBeChecked()
  await expect(dialog.getByLabel('自动显示答案等待秒数')).toHaveValue('10')
  expect(await dialog.getByRole('button', { name: '关闭', exact: true }).count()).toBe(0)
})

test('添加和编辑数学卡片、上传正反面音频、错误公式不能覆盖原内容', async ({ page, request }) => {
  const group = await deck(request)
  await page.goto(`/#/deck/${group.id}`)
  await page.getByRole('button', { name: '添加', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('正面（问题）', { exact: true }).fill('求解 \\(x^2=4\\)')
  await dialog.getByLabel('背面（答案）', { exact: true }).fill('$$x=\\pm 2$$')
  await dialog.getByLabel('内容格式', { exact: true }).selectOption('markdown_math')
  await expect(dialog.getByLabel('正面预览').locator('.katex')).toBeVisible()
  await expect(dialog.getByLabel('背面预览').locator('.katex')).toBeVisible()
  await dialog.getByLabel('正面音频', { exact: true }).setInputFiles([
    { name: '问题一.wav', mimeType: 'audio/wav', buffer: wave(.2, 45) },
    { name: '问题二.wav', mimeType: 'audio/wav', buffer: wave(.3, 56) },
  ])
  await dialog.getByRole('button', { name: '下移正面音频 1', exact: true }).click()
  await dialog.getByLabel('背面音频', { exact: true }).setInputFiles({ name: '答案.wav', mimeType: 'audio/wav', buffer: wave(.4, 78) })
  await dialog.getByRole('button', { name: '添加', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  let saved = (await api(request, `/decks/${group.id}/cards`)).cards[0]
  expect(saved.media.filter((m: { side: string }) => m.side === 'front').map((m: { originalName: string }) => m.originalName)).toEqual(['问题二.wav', '问题一.wav'])
  expect(saved.reps).toBe(0)
  const originalBack = saved.back
  await page.getByRole('button', { name: /^编辑卡片/ }).click()
  await dialog.getByLabel('背面（答案）', { exact: true }).fill('\\(\\notAFormula\\)')
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
  expect((await api(request, `/cards/${saved.id}`)).back).toBe(originalBack)
  await dialog.getByLabel('背面（答案）', { exact: true }).fill('平方根：\\(\\sqrt{4}=2\\)')
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '移除正面音频 2', exact: true }).click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  saved = await api(request, `/cards/${saved.id}`)
  expect(saved.media).toHaveLength(2); expect(saved.reps).toBe(0)
  await expect(page.locator('tbody > tr').first()).toContainText('平方根')
  await page.locator('tbody > tr').first().click()
  await expect(page.locator('tbody .katex').first()).toBeVisible()
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect(page.getByTestId('review-card').locator('.katex').first()).toBeVisible()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.getByTestId('card-answer').locator('.katex')).toBeVisible()
  expect((await api(request, `/cards/${saved.id}`)).reps).toBe(0)
  await page.screenshot({ path: '/tmp/flashnext-web-math-review.png', fullPage: true })
})

test('默认10秒自动翻面且不评分，下一张重新计时，撤销后仍能继续', async ({ page, request }) => {
  const group = await deck(request)
  const a = await api(request, `/decks/${group.id}/cards`, content('倒计时问题一'))
  await api(request, `/decks/${group.id}/cards`, content('倒计时问题二'))
  await page.clock.install()
  await review(page, group.id); await stopTime(page)
  await expect(page.getByTestId('card-answer')).not.toBeVisible()
  await page.clock.runFor(9000)
  await expect(page.getByTestId('card-answer')).not.toBeVisible()
  await page.clock.runFor(1100)
  await expect(page.getByTestId('card-answer')).toBeVisible()
  expect((await api(request, `/cards/${a.id}`)).reps).toBe(0)
  await page.getByRole('button', { name: '良好', exact: true }).click()
  await expect(page.getByTestId('review-card')).not.toHaveAttribute('data-card-id', String(a.id))
  await page.clock.runFor(9000)
  await expect(page.getByTestId('card-answer')).not.toBeVisible()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: '良好', exact: true }).click()
  await expect(page.getByTestId('review-card')).not.toBeVisible()
  await page.getByRole('button', { name: '撤销上次评分', exact: true }).click()
  await expect(page.getByTestId('review-card')).toBeVisible()
  await expect(page.getByTestId('card-answer')).not.toBeVisible()
})

test('新卡立即显示优先、关闭倒计时保持手动，离开后不串到下一次', async ({ page, request }) => {
  await page.clock.install()
  const group = await deck(request, { showNewCardAnswerImmediately: true, autoRevealAnswerSeconds: 10 })
  const card = await api(request, `/decks/${group.id}/cards`, content('立即显示的新卡'))
  await review(page, group.id)
  await expect(page.getByTestId('card-answer')).toBeVisible()
  expect((await api(request, `/cards/${card.id}`)).reps).toBe(0)
  await page.getByRole('button', { name: '退出复习', exact: true }).click()
  await api(request, `/decks/${group.id}/settings`, { showNewCardAnswerImmediately: false, autoRevealAnswerSeconds: null })
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect(page.getByTestId('review-card')).toBeVisible(); await stopTime(page)
  await page.clock.runFor(60000)
  await expect(page.getByTestId('card-answer')).not.toBeVisible()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.getByTestId('card-answer')).toBeVisible()
})

test('切到后台暂停倒计时，返回后按剩余时间继续', async ({ page, request }) => {
  const group = await deck(request)
  await api(request, `/decks/${group.id}/cards`, content('后台暂停'))
  await page.clock.install(); await review(page, group.id); await stopTime(page)
  await page.clock.runFor(4000)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.clock.runFor(20000)
  await expect(page.getByTestId('card-answer')).not.toBeVisible()
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.clock.runFor(5000); await expect(page.getByTestId('card-answer')).not.toBeVisible()
  await page.clock.runFor(1100); await expect(page.getByTestId('card-answer')).toBeVisible()
})

test('音频按顺序播放，翻面停止正面，切卡及退出停止旧音频', async ({ page, request }) => {
  const group = await deck(request, { audioAutoplay: true, autoRevealAnswerSeconds: null })
  const first = await audio(request, '正面第一段.wav', .6), second = await audio(request, '正面第二段.wav', 3), back = await audio(request, '背面.wav', 3)
  const a = await api(request, `/decks/${group.id}/cards`, { ...content('播放问题一'), media: [
    { mediaId: first.id, side: 'front', position: 0 }, { mediaId: second.id, side: 'front', position: 1 }, { mediaId: back.id, side: 'back', position: 0 },
  ] })
  await api(request, `/decks/${group.id}/cards`, { ...content('播放问题二'), media: [{ mediaId: back.id, side: 'front', position: 0 }] })
  await review(page, group.id)
  const front = page.getByLabel('正面音频 2', { exact: true })
  await expect.poll(() => front.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false)
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect.poll(() => front.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true)
  await expect.poll(() => page.getByLabel('背面音频 1', { exact: true }).evaluate((element: HTMLAudioElement) => element.paused)).toBe(false)
  await page.evaluate(() => { (window as any).__oldAudio = [...document.querySelectorAll('audio')] })
  await page.getByRole('button', { name: '良好', exact: true }).click()
  await expect(page.getByTestId('review-card')).not.toHaveAttribute('data-card-id', String(a.id))
  expect(await page.evaluate(() => (window as any).__oldAudio.every((element: HTMLAudioElement) => element.paused))).toBe(true)
  await page.evaluate(() => { (window as any).__oldAudio = [...document.querySelectorAll('audio')] })
  await page.getByRole('button', { name: '退出复习', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__oldAudio.every((element: HTMLAudioElement) => element.paused))).toBe(true)
})

test('浏览器拦截自动播放时显示提示并保留手动播放器，新卡只自动播放背面', async ({ page, request }) => {
  const group = await deck(request, { audioAutoplay: true, showNewCardAnswerImmediately: true })
  const sound = await audio(request, '立即答案.wav', 2)
  await api(request, `/decks/${group.id}/cards`, { ...content('自动播放被限制'), media: [
    { mediaId: sound.id, side: 'front', position: 0 }, { mediaId: sound.id, side: 'back', position: 0 },
  ] })
  await page.addInitScript(() => {
    ;(window as any).__playCalls = []
    HTMLMediaElement.prototype.play = function () {
      ;(window as any).__playCalls.push(this.getAttribute('aria-label'))
      return Promise.reject(new DOMException('Autoplay disabled', 'NotAllowedError'))
    }
  })
  await review(page, group.id)
  await expect(page.getByText('浏览器未允许自动播放，请点击播放器播放。', { exact: true })).toBeVisible()
  await expect(page.getByLabel('背面音频 1', { exact: true })).toHaveAttribute('controls', '')
  expect(await page.evaluate(() => (window as any).__playCalls)).toEqual(['背面音频 1'])
})

test('手机端编辑和公式显示不溢出', async ({ page, request }) => {
  const group = await deck(request)
  await api(request, `/decks/${group.id}/cards`, { ...content('手机公式 \\(x^2=4\\)', '$$x=\\pm2$$'), contentFormat: 'markdown_math' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/#/deck/${group.id}`)
  await page.getByRole('button', { name: /^编辑卡片/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('正面预览').locator('.katex')).toBeVisible()
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/flashnext-web-card-editor-mobile.png', fullPage: true })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await expect(page.getByTestId('card-answer').locator('.katex')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})


test('手动翻面、评分和退出会取消旧倒计时，重新进入从10秒开始', async ({ page, request }) => {
  const group = await deck(request)
  const card = await api(request, `/decks/${group.id}/cards`, content('手动计时第一张'))
  await api(request, `/decks/${group.id}/cards`, content('手动计时第二张'))
  await page.clock.install(); await review(page, group.id); await stopTime(page)
  await page.clock.runFor(4000)
  await page.getByRole('button', { name: '显示答案', exact: true }).click()
  await page.getByRole('button', { name: '良好', exact: true }).click()
  await expect(page.getByTestId('review-card')).not.toHaveAttribute('data-card-id', String(card.id))
  await page.clock.runFor(6500)
  await expect(page.getByTestId('card-answer')).not.toBeVisible()
  await page.getByRole('button', { name: '退出复习', exact: true }).click()
  await page.clock.runFor(20000)
  await page.getByRole('button', { name: '复习', exact: true }).click()
  await expect(page.getByTestId('review-card')).toBeVisible()
  await page.clock.runFor(9000); await expect(page.getByTestId('card-answer')).not.toBeVisible()
  await page.clock.runFor(1100); await expect(page.getByTestId('card-answer')).toBeVisible()
  expect((await api(request, `/cards/${card.id}`)).reps).toBe(1)
})

test('编辑预览忽略过期响应，保存失败保留输入，重试后能保存', async ({ page, request }) => {
  const group = await deck(request)
  const card = await api(request, `/decks/${group.id}/cards`, content('原始问题'))
  await page.goto(`/#/deck/${group.id}`)
  await page.getByRole('button', { name: /^编辑卡片/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('内容格式', { exact: true }).selectOption('markdown_math')
  let olderStarted!: () => void
  const older = new Promise<void>(resolve => { olderStarted = resolve })
  await page.route('**/api/content/preview', async route => {
    if (route.request().postDataJSON().front.includes('前一版')) { olderStarted(); await new Promise(resolve => setTimeout(resolve, 900)) }
    try { const response = await route.fetch(); await route.fulfill({ response }) } catch { /* An obsolete request may have been cancelled. */ }
  })
  await dialog.getByLabel('正面（问题）', { exact: true }).fill('前一版 \\(x=1\\)')
  await older
  await dialog.getByLabel('正面（问题）', { exact: true }).fill('最终版 \\(x=2\\)')
  await expect(dialog.getByLabel('正面预览')).toContainText('最终版')
  await expect(dialog.getByLabel('正面预览').locator('.katex')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
  await page.route(`**/api/cards/${card.id}`, route => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, json: { message: '暂时无法保存', data: false } }) : route.continue())
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('暂时无法保存')
  await expect(dialog.getByLabel('正面（问题）', { exact: true })).toHaveValue('最终版 \\(x=2\\)')
  expect((await api(request, `/cards/${card.id}`)).front).toBe('原始问题')
  await page.unroute(`**/api/cards/${card.id}`)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect((await api(request, `/cards/${card.id}`)).front).toBe('最终版 \\(x=2\\)')
})
