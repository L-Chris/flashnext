const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { overrides, dictionaryTranslation } = require('../lib/definition-overrides')
const { lookupEcdict } = require('../lib/ecdict')
const { planRepair } = require('../repair-definition-aliases')

test('all reviewed corrections have actual meanings, provenance and stable re-imports', () => {
  assert.equal(Object.keys(overrides).length, 27) // Includes the 2 earlier hybrid- fixes.
  for (const [headword, o] of Object.entries(overrides)) {
    assert.equal(dictionaryTranslation(headword, o.replaces), o.translation)
    assert.match(o.translation, /[\u3400-\u9fff]/)
    assert.ok(o.references.length)
    assert.equal(dictionaryTranslation(headword, o.translation), o.translation)
    assert.equal(dictionaryTranslation(headword, '人工另写的释义'), '人工另写的释义')
  }
})

test('LED is an acronym; led retains its verb-form identity', () => {
  assert.match(dictionaryTranslation('LED', 'lead的过去式和过去分词'), /发光二极管/)
  assert.equal(dictionaryTranslation('led', 'lead的过去式和过去分词'), 'lead的过去式和过去分词')
  assert.doesNotMatch(dictionaryTranslation('unspoken', 'unspeak的过去分词'), /unspeak/)
})

test('repair synchronizes generated cards, POS and summaries while preserving notes', () => {
  const old = overrides.stuck.replaces
  const w = { id: 1, headword: 'stuck', translation: old, pos: '', phonetic: 'stʌk', cards: [
    { id: 2, front: 'stuck', back: '/stʌk/\n' + old },
    { id: 3, front: 'stuck', back: '自定义笔记' },
  ], knowledgeEntity: { id: 4, summary: old } }
  const plan = planRepair([w])
  assert.equal(plan.words.length, 1)
  assert.equal(plan.words[0].posBefore, '')
  assert.equal(plan.words[0].posAfter, 'a. v.')
  assert.deepEqual(plan.cards.map(r => r.id), [2])
  assert.deepEqual(plan.entities.map(r => r.id), [4])
  assert.deepEqual(plan.protectedCards, [3])
  w.translation = plan.words[0].after; w.pos = plan.words[0].posAfter
  assert.equal(planRepair([w]).words.length, 0)
  assert.equal(w.cards[1].back, '自定义笔记')
})

test('ECDICT skips CSV headers and keeps exact-case word identity and quoted text', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashnext-ecdict-'))
  try {
    const file = path.join(dir, 'fixture.csv')
    fs.writeFileSync(file, '\uFEFFword,phonetic,definition,translation,pos\n' + [
      'word,wɜːd,,"n. 单词, 话语",n.',
      'led,led,,lead的过去式和过去分词,v.',
      'LED,el iː diː,,n. 发光二极管,n.',
      'pacific,pəˈsɪfɪk,,a. 和平的,a.',
      'Pacific,pəˈsɪfɪk,,n. 太平洋,n.',
      'quote,kwəʊt,,"n. 引文, ""引用""",n.',
    ].join('\n'))
    const rows = await lookupEcdict(file, ['word', 'led', 'LED', 'Led', 'Pacific', 'pacific', 'quote'])
    assert.equal(rows.get('word').translation, 'n. 单词, 话语')
    assert.equal(rows.get('word').phonetic, 'wɜːd')
    assert.equal(rows.get('LED').translation, 'n. 发光二极管')
    assert.equal(rows.get('led').translation, 'lead的过去式和过去分词')
    assert.equal(rows.has('Led'), false)
    assert.equal(rows.get('Pacific').translation, 'n. 太平洋')
    assert.equal(rows.get('pacific').translation, 'a. 和平的')
    assert.equal(rows.get('quote').translation, 'n. 引文, "引用"')
  } finally { fs.rmSync(dir, { recursive: true }) }
})

test('a reviewed uppercase entry can fill a missing acronym without borrowing led', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashnext-led-'))
  try {
    const file = path.join(dir, 'fixture.csv')
    fs.writeFileSync(file, 'word,phonetic,definition,translation,pos\nled,led,,lead的过去式和过去分词,v.\nstore-bought,,, = shop-bought,\n')
    const rows = await lookupEcdict(file, ['LED', 'led', 'store-bought'])
    assert.match(rows.get('LED').translation, /发光二极管/)
    assert.equal(rows.get('LED').phonetic, '')
    assert.equal(rows.get('led').translation, 'lead的过去式和过去分词')
    assert.match(rows.get('store-bought').translation, /商店里买的/)
  } finally { fs.rmSync(dir, { recursive: true }) }
})

test('LED keeps its entity ID while separating its legacy key from lowercase led', () => {
  const w = { id: 1, headword: 'LED', pos: '', phonetic: 'led', translation: overrides.LED.replaces, cards: [], knowledgeEntity: { id: 20, canonicalKey: 'en:word:led', summary: overrides.LED.replaces } }
  const plan = planRepair([w])
  assert.equal(plan.entities[0].id, 20)
  assert.equal(plan.entities[0].keyBefore, 'en:word:led')
  assert.equal(plan.entities[0].keyAfter, 'en:word:LED')
})
