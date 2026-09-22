import { useState } from 'react'
import type { WordPronunciation } from '../types'

export function formatPhonetic(value?: string) {
  const text = value?.trim() || ''
  if (!text) return ''
  // Preserve narrow transcriptions; never silently relabel them as phonemic IPA.
  if (text.startsWith('[') && text.endsWith(']')) return text
  return `/${text.replace(/^\/+|\/+$/g, '')}/`
}
const POS: Record<string, string> = { noun: 'n.', verb: 'v.', adj: 'adj.', adv: 'adv.', prep: 'prep.', name: '专名', pron: 'pron.', intj: 'int.' }

export default function Pronunciations({ items, fallback, compact = false, legacyLabel = '' }: {
  items?: WordPronunciation[]; fallback?: string; compact?: boolean; legacyLabel?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const groups = new Map<string, { ipa: string; pos: Set<string>; hints: Set<string> }>()
  for (const p of items || []) {
    if (p.status !== 'accepted' || !p.displayIpa) continue
    const key = `${p.accent}:${p.displayIpa}`
    const g = groups.get(key) || { ipa: p.displayIpa, pos: new Set<string>(), hints: new Set<string>() }
    g.pos.add(POS[p.pos] || p.pos)
    if (p.usage) g.hints.add(p.usage.replace(/^词源 .*? · /, ''))
    groups.set(key, g)
  }
  const rows = [...groups.values()].sort((a,b) => Number(b.ipa === fallback) - Number(a.ipa === fallback))
  if (!rows.length) return fallback ? <span>{formatPhonetic(fallback)}{legacyLabel && <small className="ml-1 text-xs text-zinc-500">{legacyLabel}</small>}</span> : null
  const visible = compact && !expanded ? rows.slice(0, 2) : rows
  return <span className="inline-flex flex-col gap-1 text-left">
    {visible.map(r => <span key={r.ipa} title={[...r.hints].join('; ')}>
      <small className="mr-1 text-xs text-zinc-500">英{rows.length > 1 ? ` · ${[...r.pos].join('/')}` : ''}</small>
      {formatPhonetic(r.ipa)}
      {expanded && rows.length > 1 && <span className="block max-w-xl text-xs text-zinc-500">{[...r.hints].join('; ')}</span>}
    </span>)}
    {rows.length > 1 && <button type="button" onClick={() => setExpanded(!expanded)} className="text-left text-xs text-indigo-600 dark:text-indigo-400">{expanded ? '收起读音说明' : `查看 ${rows.length} 种读音及用法`}</button>}
  </span>
}
