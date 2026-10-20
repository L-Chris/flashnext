const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const esbuild = require('../../node_modules/esbuild')
function load(file) {
  const code = esbuild.buildSync({ entryPoints: [path.resolve(__dirname, file)], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
  const module = { exports: {} }; new Function('module','exports','require',code)(module,module.exports,require); return module.exports
}
const frontend = load('../../../web/src/utils/word-card.ts')
const backend = load('../../app/shared/word-card.ts')
test('Japanese back has kana and POS without IPA decoration; custom notes remain intact', () => {
  const word = { language: 'ja', headword: '学生', reading: 'がくせい', pos: '名词', translation: '学生', phonetic: '' }
  const back = backend.wordCardBack(word)
  assert.equal(back,'がくせい\n名词\n学生')
  assert.equal(frontend.japaneseCardBack(word),back)
  assert.deepEqual(frontend.reviewWordBack(back,word),{phonetic:'',meanings:'学生',reading:'がくせい',pos:'名词',isWordBack:true})
  assert.equal(frontend.reviewWordBack('my note\\nkept',word).meanings,'my note\\nkept')
  assert.equal(frontend.reviewWordBack('my note',word).reading,'')
})
test('English answer conventions are preserved', () => {
  const word={language:'en',reading:'',pos:'n.',phonetic:'kæt',translation:'n. 猫'}
  assert.equal(backend.wordCardBack(word),'/kæt/\nn. 猫')
  assert.equal(frontend.reviewWordBack('/kæt/\nn. 猫',word).phonetic,'/kæt/')
})
