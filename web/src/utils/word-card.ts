import { reviewBack } from './dictionary-text'
import type { WordPronunciation } from '../types'

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

// Hide a generated translation only when the visible pronunciation notes cover
// every meaning with the same POS. Uncertain matches keep the original text.
export function pronunciationNotesCoverMeanings(meanings: string, items?: WordPronunciation[]) {
  const accepted = (items || []).filter(p => p.status === 'accepted' && p.displayIpa.trim())
  const sounds = new Set(accepted.map(p => `${p.accent}:${p.displayIpa.trim().replace(/^\/+|\/+$/g, '')}`))
  // Single-sound cards do not show pronunciation notes.
  if (sounds.size < 2 || !meanings.trim()) return false
  const posNames: Record<string, string> = {
    n: 'noun', v: 'verb', adj: 'adj', adv: 'adv', prep: 'prep', pron: 'pron',
    conj: 'conj', det: 'det', int: 'intj', num: 'num',
  }
  const terms = (text: string) => text.normalize('NFKC').split(/[,、;；]/).map(term => term.replace(/\s+/g, '')).filter(Boolean)
  const covered = new Map<string, Set<string>>()
  for (const p of accepted) {
    const usage = p.usage.replace(/^词源 .*? · /, '').replace(/^.*[：:]/, '')
    const meaningsForPos = covered.get(p.pos) || new Set<string>()
    for (const term of terms(usage)) if (/\p{Script=Han}/u.test(term)) meaningsForPos.add(term)
    covered.set(p.pos, meaningsForPos)
  }
  return meanings.split('\n').filter(line => line.trim()).every(line => {
    const match = line.trim().match(/^([a-z]+)\.\s*(.+)$/)
    if (!match) return false
    const pos = posNames[match[1]]
    const glosses = terms(match[2])
    return Boolean(pos && glosses.length && glosses.every(gloss => covered.get(pos)?.has(gloss)))
  })
}
