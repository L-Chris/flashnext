// Keep in step with server/scripts/lib/dictionary-text.js (covered by shared cases).
export const normalizeDictionaryNewlines = (text: string): string =>
  text.replace(/\\+r\\+n|\\+[nr]|\r\n?/g, '\n')

export function reviewBack(back: string, translation?: string) {
  const split = (text: string) => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    const phonetic = /^\/[^\n]+\/$/.test(lines[0]) ? lines.shift()! : ''
    return { phonetic, meanings: lines.join('\n') }
  }
  const original = split(back)
  const normalized = split(normalizeDictionaryNewlines(back))
  const isWordBack = translation !== undefined &&
    normalized.meanings === normalizeDictionaryNewlines(translation)
  return { ...(isWordBack ? normalized : original), isWordBack }
}
