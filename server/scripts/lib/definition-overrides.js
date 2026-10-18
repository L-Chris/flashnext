const overrides = require('../resources/definition-overrides.json')
const { normalizeDictionaryNewlines } = require('./dictionary-text')

function dictionaryTranslation(headword, source) {
  const text = normalizeDictionaryNewlines(source)
  const override = overrides[headword] ?? overrides[headword.toLowerCase()]
  // Replace only the known incomplete source value. Never override a newer
  // definition or a user's independently edited translation.
  return override && text.trim() === override.replaces.trim() ? override.translation : text
}
module.exports = { overrides, dictionaryTranslation }
