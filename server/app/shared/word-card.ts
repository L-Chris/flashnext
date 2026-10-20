import { dictionaryCardBack } from '../../scripts/lib/dictionary-text'

export const wordCardBack = (word: { language: string; phonetic: string; translation: string; reading: string; pos: string }) =>
  word.language === 'ja'
    ? [word.reading, word.pos, word.translation].filter(Boolean).join('\n')
    : dictionaryCardBack(word.phonetic, word.translation)
