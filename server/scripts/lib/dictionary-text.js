// ECDICT stores line breaks as literal backslash sequences. This decoder is
// deliberately limited to dictionary text; it must not unescape generic notes.
const normalizeDictionaryNewlines = text => text.replace(/\\+r\\+n|\\+[nr]|\r\n?/g, '\n')

const dictionaryCardBack = (phonetic, translation) =>
  (phonetic ? `/${phonetic}/\n` : '') + normalizeDictionaryNewlines(translation)

module.exports = { normalizeDictionaryNewlines, dictionaryCardBack }
