const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeDictionaryNewlines: normalize, dictionaryCardBack } = require('../lib/dictionary-text')
const { planRepair } = require('../repair-dictionary-newlines')

test('dictionary newline variants normalize once, without general unescaping', () => {
  for (const input of ['n. 岩浆\\n[化] 晶浆', 'n. 岩浆\\\\n[化] 晶浆', 'n. 岩浆\\r\\n[化] 晶浆', 'n. 岩浆\r\n[化] 晶浆', 'n. 岩浆\r[化] 晶浆']) {
    assert.equal(normalize(input), 'n. 岩浆\n[化] 晶浆')
    assert.equal(normalize(normalize(input)), normalize(input))
  }
  assert.equal(normalize('保留\\t和\\u4e00以及普通文字'), '保留\\t和\\u4e00以及普通文字')
})

test('repair updates only the corresponding generated cards and matching summaries', () => {
  const dirty = 'n. 岩浆\\n[化] 晶浆'
  const custom = '/old/\n'+dirty+'\n我的笔记：保留\\n原样'
  const words = [{ id: 1, headword: 'magma', translation: dirty, phonetic: 'new', phoneticLegacy: 'old',
    cards: [{ id: 10, front: 'magma', back: '/new/\n'+dirty }, { id: 11, front: 'magma', back: '/old/\n'+dirty }, { id: 12, front: 'magma', back: custom }],
    knowledgeEntity: { id: 20, summary: dirty } },
    { id: 2, headword: 'clean', translation: '干净', cards: [] },
    { id: 3, headword: 'other', translation: dirty, cards: [], knowledgeEntity: { id: 21, summary: '用户修改的摘要' } }]
  const plan = planRepair(words)
  assert.equal(plan.words.length, 2)
  assert.deepEqual(plan.cards.map(c => c.id), [10, 11])
  assert.deepEqual(plan.protectedCards, [12])
  assert.deepEqual(plan.entities.map(e => e.id), [20])
  assert.equal(words[0].cards[2].back, custom)
  for (const w of words) w.translation = normalize(w.translation)
  assert.equal(planRepair(words).words.length, 0)
  assert.equal(dictionaryCardBack('new', dirty), '/new/\nn. 岩浆\n[化] 晶浆')
})

const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const frontendPath = path.resolve(__dirname, '../../../web/src/utils/dictionary-text.ts')
const compiled = require('esbuild').transformSync(fs.readFileSync(frontendPath, 'utf8'), { loader: 'ts', format: 'cjs' }).code
const frontendModule = new Module(frontendPath, module)
frontendModule._compile(compiled, frontendPath)
const frontend = frontendModule.exports

test('review splits imported escaped text but preserves arbitrary user notes', () => {
  const translation = 'n. 岩浆\\n[化] 晶浆'
  const expected = { phonetic: '/ipa/', meanings: 'n. 岩浆\n[化] 晶浆', isWordBack: true }
  assert.deepEqual(frontend.reviewBack('/ipa/\n'+translation, translation), expected)
  assert.deepEqual(frontend.reviewBack('/ipa/\\n'+translation, translation), expected)
  const custom = '笔记中的 C:\\notes 保留原样'
  assert.equal(frontend.reviewBack(custom, translation).meanings, custom)
  assert.equal(frontend.reviewBack('/leading slash is text, not IPA', undefined).meanings, '/leading slash is text, not IPA')
  assert.equal(frontend.reviewBack('二氧化碳\\n[化] 二氧化碳', '二氧化碳\\n[化] 二氧化碳').phonetic, '')
})

test('frontend and import use the same newline convention', () => {
  for (const value of ['n. 岩浆\\n[化] 晶浆', 'a\\r\\nb', 'a\r\nb', 'a\\\\nb', '保留\\t与iː']) {
    assert.equal(frontend.normalizeDictionaryNewlines(value), normalize(value))
  }
})
