import { reviewBack } from './dictionary-text'

type Word = { language?: string; translation?: string; reading?: string; pos?: string }
export const japaneseCardBack = (word: Word) => [word.reading, word.pos, word.translation].filter(Boolean).join('\n')
export function reviewWordBack(back: string, word?: Word | null) {
  if (word?.language === 'ja') {
    const generated = back === japaneseCardBack(word)
    return { phonetic: '', meanings: generated ? word.translation || '' : back, isWordBack: generated,
      reading: generated ? word.reading || '' : '', pos: generated ? word.pos || '' : '' }
  }
  return { ...reviewBack(back, word?.translation), reading: '', pos: '' }
}
