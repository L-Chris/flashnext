import { useState } from 'react'
import type { WordPronunciation } from '../types'

export function formatPhonetic(value?: string) {
  const text = value?.trim() || ''
  if (!text) return ''
  // Preserve narrow transcriptions; never silently relabel them as phonemic IPA.
  if (text.startsWith('[') && text.endsWith(']')) return text
  return `/${text.replace(/^\/+|\/+$/g, '')}/`
}
const POS: Record<string, string> = {
  noun: 'n.', verb: 'v.', adj: 'adj.', adv: 'adv.', prep: 'prep.', name: '专名',
  pron: 'pron.', intj: 'int.', conj: 'conj.', det: 'det.', num: '数词',
  particle: '小品词', phrase: '短语', postp: '后置词', prep_phrase: '介词短语',
}
const ACCENTS: Record<string, string> = { UK: '英', US: '美' }
const GENERIC_USAGE = /^(?:名词|动词|形容词|副词|介词|代词|感叹词|连词|限定词|数词|专名)读法$/

function usageLabel(p: WordPronunciation) {
  const usage = p.usage.replace(/^词源 .*? · /, '').trim()
  const pos = POS[p.pos] || p.pos
  return [pos, GENERIC_USAGE.test(usage) ? '' : usage].filter(Boolean).join(' ')
}

export default function Pronunciations({ items, fallback, compact = false, legacyLabel = '' }: {
  items?: WordPronunciation[]; fallback?: string; compact?: boolean; legacyLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const groups = new Map<string, { accent: string; ipa: string; labels: Set<string> }>()
  for (const p of items || []) {
    if (p.status !== 'accepted' || !p.displayIpa) continue
    const ipa = formatPhonetic(p.displayIpa)
    const key = `${p.accent}:${ipa}`
    const g = groups.get(key) || { accent: p.accent, ipa, labels: new Set<string>() }
    g.labels.add(usageLabel(p))
    groups.set(key, g)
  }
  const sounds = [...groups.values()].sort((a,b) => Number(b.ipa === formatPhonetic(fallback)) - Number(a.ipa === formatPhonetic(fallback)))
  if (!sounds.length) return fallback ? <span>{formatPhonetic(fallback)}{legacyLabel && <small className="ml-1 text-xs text-zinc-500">{legacyLabel}</small>}</span> : null
  // Keep meaning/POS attached to its sound. Only combine alternatives whose
  // complete usage labels match; sharing a part of speech alone is not enough.
  const usages = new Map<string, { accent: string; ipas: string[]; labels: string[] }>()
  for (const sound of sounds) {
    const labels = [...sound.labels].filter(Boolean).sort()
    const key = JSON.stringify([sound.accent, labels])
    const usage = usages.get(key) || { accent: sound.accent, ipas: [], labels }
    usage.ipas.push(sound.ipa)
    usages.set(key, usage)
  }
  const rows = [...usages.entries()]
  const visible = compact && !expanded ? rows.slice(0, 2) : rows
  return <span className="inline-flex max-w-full flex-col gap-2 text-left [overflow-wrap:anywhere]" data-testid="pronunciations">
    {visible.map(([key, r]) => <span key={key} data-testid="pronunciation-usage">
      <small className="mr-1 text-xs text-zinc-500">{ACCENTS[r.accent] || r.accent}</small>
      <span>{r.ipas.map((ipa, index) => <span key={ipa}>
        {index > 0 && <small className="mx-1 text-xs text-zinc-500">或</small>}{ipa}
      </span>)}</span>
      {sounds.length > 1 && r.labels.length > 0 && <span className="block max-w-xl text-xs text-zinc-500">{r.labels.join('；')}</span>}
    </span>)}
    {compact && rows.length > 2 && <button type="button" aria-expanded={expanded} onClick={event => { event.stopPropagation(); setExpanded(!expanded) }} className="text-left text-xs text-indigo-600 dark:text-indigo-400">{expanded ? '收起其他读音' : `展开其他 ${rows.length - 2} 组用法`}</button>}
  </span>
}
