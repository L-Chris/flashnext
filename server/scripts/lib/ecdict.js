const fs = require('fs')
const readline = require('readline')
const { dictionaryTranslation, overrides } = require('./definition-overrides')

function parseCsvLine(line) {
  const values = []
  let value = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++ }
      else quoted = !quoted
    } else if (char === ',' && !quoted) { values.push(value); value = '' }
    else value += char
  }
  values.push(value)
  values[0] = values[0].replace(/^\uFEFF/, '')
  return values
}

const isHeader = cols => cols[0] === 'word' && cols[1] === 'phonetic' && cols[3] === 'translation'

async function lookupEcdict(file, headwords) {
  const wanted = new Set(headwords), found = new Map()
  const complete = () => {
    // A reviewed entry may be supplied explicitly when the exact spelling is
    // absent. Never borrow the definition of a differently cased word.
    for (const headword of wanted) {
      const entry = overrides[headword]
      if (!found.has(headword) && entry) found.set(headword, { headword, phonetic: '', translation: entry.translation, pos: entry.pos || '' })
    }
    return found
  }
  if (!fs.existsSync(file)) return complete()
  const stream = fs.createReadStream(file, 'utf8')
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (!line) continue
      const cols = parseCsvLine(line)
      if (isHeader(cols) || cols.length < 4 || !wanted.has(cols[0]) || found.has(cols[0])) continue
      const headword = cols[0], translation = dictionaryTranslation(headword, cols[3] || '')
      found.set(headword, {
        headword, phonetic: cols[1] || '', translation,
        pos: (overrides[headword]?.translation === translation ? overrides[headword]?.pos : '') || (translation.match(/^((?:[a-z&]+\.\s*)+)/) || [])[1]?.trim() || cols[4] || '',
      })
      if (found.size === wanted.size) break
    }
  } finally { lines.close(); stream.destroy() }
  return complete()
}
module.exports = { lookupEcdict, parseCsvLine, isHeader }
