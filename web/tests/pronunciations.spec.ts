import { test, expect, type Page } from '@playwright/test'
import type { Card, WordPronunciation } from '../src/types'

const usage = { newCount: 0, reviewCount: 0, newLimit: 25, reviewLimit: 500, newRemaining: 25, reviewRemaining: 500 }
const counts = { intraday: 0, review: 0, fresh: 1, hiddenByLimit: 0 }
function pronunciation(displayIpa: string, pos: string, usage: string, extra: Partial<WordPronunciation> = {}): WordPronunciation {
  return { id: 1, displayIpa, rawIpa: `/${displayIpa}/`, pos, usage, accent: 'UK', status: 'accepted', source: 'reviewed', ...extra }
}
function card(front: string, pronunciations: WordPronunciation[]): Card {
  const translation = 'n. 测试释义', phonetic = pronunciations[0]?.displayIpa || ''
  return { id: 1, deckId: 9, wordId: 1, front, back: `/${phonetic}/\n${translation}`, contentFormat: 'plain',
    stability: 0, difficulty: 0, state: 0, reps: 0, lapses: 0, learningSteps: 0, interval: 0,
    due: '2026-10-21T00:00:00.000Z', lastReview: null, createdAt: '2026-10-21T00:00:00.000Z',
    media: [], presentation: { answerRevealAfterMs: 0, audioAutoplay: false, settingsVersion: 1 },
    word: { id: 1, language: 'en', headword: front, phonetic, translation, pos: 'n.', rank: null, tags: [], pronunciations } }
}
async function show(page: Page, sample: Card, table = false) {
  // All API calls are intercepted, including unexpected mutations. No real
  // learning queue or production database is touched by these display tests.
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    expect(route.request().method()).toBe('GET')
    const path = new URL(route.request().url()).pathname
    if (path === '/api/content/assets/katex.min.css') {
      await route.fulfill({ contentType: 'text/css', body: '' }); return
    }
    let data: unknown
    if (path === '/api/decks') data = [{ id: 9, name: '英语单词', language: 'en', description: '', createdAt: sample.createdAt, dueCount: 1, usage, counts }]
    else if (path === '/api/decks/9/cards/due') data = { cards: [sample], counts, usage }
    else if (path === '/api/decks/9/cards') data = { cards: [sample], total: 1, page: 1, pageSize: 50, totalPages: 1 }
    else throw new Error(`Unexpected API request: ${path}`)
    await route.fulfill({ json: { message: 'ok', data } })
  })
  page.on('pageerror', error => { throw error })
  await page.goto(table ? '/#/deck/9' : '/#/review/9')
  if (table) {
    await page.getByRole('button', { name: '列', exact: true }).click()
    await page.getByLabel('读音', { exact: true }).check()
    await page.getByRole('button', { name: '完成', exact: true }).click()
  }
  await expect(page.getByTestId('pronunciations')).toBeVisible()
}

for (const viewport of [{ width: 1200, height: 850 }, { width: 390, height: 844 }]) {
  test(`同词性不同词义默认显示，${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const sample = card('primate', [pronunciation('ˈpraɪmeɪt', 'noun', '灵长目动物'), pronunciation('ˈpraɪmət', 'noun', '首席主教、大主教')])
    sample.word!.translation = 'n. 大主教, 灵长目动物'
    sample.back = `/ˈpraɪmeɪt/\n${sample.word!.translation}`
    await show(page, sample)
    const rows = page.getByTestId('pronunciation-usage')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('/ˈpraɪmeɪt/')
    await expect(rows.nth(0)).toContainText('n. 灵长目动物')
    await expect(rows.nth(1)).toContainText('/ˈpraɪmət/')
    await expect(rows.nth(1)).toContainText('n. 首席主教、大主教')
    await expect(page.getByRole('button', { name: /查看.*读音/ })).toHaveCount(0)
    await expect(page.getByTestId('word-meanings')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

test('read 的时态区别保留，共用音标的词性与词义保持对应', async ({ page }) => {
  await show(page, card('read', [
    pronunciation('riːd', 'verb', '原形／现在时：读'), pronunciation('red', 'verb', '过去式／过去分词：读'),
    pronunciation('riːd', 'noun', '阅读'),
  ]))
  const rows = page.getByTestId('pronunciation-usage')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('v. 原形／现在时：读')
  await expect(rows.nth(0)).toContainText('n. 阅读')
  await expect(rows.nth(0)).not.toContainText('过去式')
  await expect(rows.nth(1)).toContainText('v. 过去式／过去分词：读')
})

test('同一用法的变体合并，以默认音标为先，去除重复和未采用候选', async ({ page }) => {
  const sample = card('fungi', [
    pronunciation('ˈfʌŋɡiː', 'noun', 'fungus 的复数：真菌'), pronunciation('ˈfʌndʒaɪ', 'noun', 'fungus 的复数：真菌'),
    pronunciation('/ˈfʌndʒaɪ/', 'noun', 'fungus 的复数：真菌'), pronunciation('ˈfʌŋɡaɪ', 'noun', 'fungus 的复数：真菌'),
    pronunciation('WRONG', 'noun', '错误候选', { status: 'review' }),
  ])
  sample.word!.phonetic = 'ˈfʌndʒaɪ'; sample.back = `/ˈfʌndʒaɪ/\n${sample.word!.translation}`
  await show(page, sample)
  await expect(page.getByTestId('pronunciation-usage')).toHaveCount(1)
  await expect(page.getByTestId('pronunciations')).toHaveText('英/ˈfʌndʒaɪ/或/ˈfʌŋɡiː/或/ˈfʌŋɡaɪ/n. fungus 的复数：真菌')
})

test('多词性读音直接标注词性，通用说明不重复', async ({ page }) => {
  await show(page, card('permit', [pronunciation('ˈpɜːmɪt', 'noun', '名词读法'), pronunciation('pəˈmɪt', 'verb', '动词读法')]))
  await expect(page.getByTestId('pronunciation-usage').nth(0)).toContainText('n.')
  await expect(page.getByTestId('pronunciation-usage').nth(1)).toContainText('v.')
  await expect(page.getByTestId('pronunciations')).not.toContainText('读法')
})

test('列表可展开全部用法，点击展开不触发整张卡片展开', async ({ page }) => {
  await show(page, card('sample', [
    pronunciation('a', 'noun', '义项一'), pronunciation('b', 'noun', '义项二'), pronunciation('c', 'noun', '义项三'),
  ]), true)
  await expect(page.getByTestId('pronunciation-usage')).toHaveCount(2)
  await page.getByRole('button', { name: '展开其他 1 组用法' }).click()
  await expect(page.getByTestId('pronunciation-usage')).toHaveCount(3)
  await expect(page.getByTestId('pronunciation-usage').nth(2)).toContainText('义项三')
  await expect(page.locator('tbody > tr')).toHaveCount(1)
  await page.getByRole('button', { name: '收起其他读音' }).click()
  await expect(page.getByTestId('pronunciation-usage')).toHaveCount(2)
})

test('不同口音不合并', async ({ page }) => {
  await show(page, card('sample', [pronunciation('test', 'noun', '名词读法'), pronunciation('test', 'noun', '名词读法', { accent: 'US' })]))
  await expect(page.getByTestId('pronunciation-usage')).toHaveCount(2)
  await expect(page.getByTestId('pronunciation-usage').nth(0)).toContainText('英')
  await expect(page.getByTestId('pronunciation-usage').nth(1)).toContainText('美')
})

test('单读音保持简洁', async ({ page }) => {
  const sample = card('teacher', [pronunciation('ˈtiːtʃə(r)', 'noun', '教师')])
  sample.word!.translation = 'n. 教师'; sample.back = '/ˈtiːtʃə(r)/\nn. 教师'
  await show(page, sample)
  await expect(page.getByTestId('pronunciations')).toHaveText('英/ˈtiːtʃə(r)/')
  await expect(page.getByTestId('pronunciations').getByRole('button')).toHaveCount(0)
  await expect(page.getByTestId('word-meanings')).toHaveText('n.教师')
})

for (const scenario of [
  { name: '仍有补充义项', translation: 'n. 大主教, 灵长目动物, 新的补充义项', notes: ['灵长目动物', '首席主教、大主教'] },
  { name: '只有词性说明', translation: 'n. 大主教, 灵长目动物', notes: ['名词读法', '名词读法'] },
  { name: '原释义词性不同', translation: 'v. 大主教, 灵长目动物', notes: ['灵长目动物', '首席主教、大主教'] },
]) {
  test(`保留未被完整涵盖的释义：${scenario.name}`, async ({ page }) => {
    const sample = card('primate', [pronunciation('ˈpraɪmeɪt', 'noun', scenario.notes[0]), pronunciation('ˈpraɪmət', 'noun', scenario.notes[1])])
    sample.word!.translation = scenario.translation; sample.back = `/ˈpraɪmeɪt/\n${scenario.translation}`
    await show(page, sample)
    await expect(page.getByTestId('word-meanings')).toBeVisible()
    await expect(page.getByTestId('word-meanings')).toContainText(scenario.translation.slice(3))
  })
}

test('自定义卡背不插入词典多读音说明', async ({ page }) => {
  const sample = card('read', [pronunciation('riːd', 'verb', '原形／现在时：读'), pronunciation('red', 'verb', '过去式／过去分词：读')])
  sample.back = '/[riːd]/\n我的笔记'
  // show() also verifies the dictionary component is present, so handle this
  // case after initially loading the normal review, then replace its route.
  const dictionarySample = { ...sample, back: `/riːd/\n${sample.word!.translation}` }
  await show(page, dictionarySample)
  await page.route('**/api/decks/9/cards/due', route => route.fulfill({ json: { message: 'ok', data: { cards: [sample], counts, usage } } }))
  await page.reload()
  await expect(page.getByTestId('card-answer')).toContainText('我的笔记')
  await expect(page.getByTestId('card-answer')).not.toContainText('过去式')
  await expect(page.getByTestId('pronunciations')).toHaveCount(0)
})
