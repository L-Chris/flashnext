import type { WordSense } from '../types'

export const parseList = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export default function SenseExamples({ senses }: { senses?: WordSense[] }) {
  if (!senses?.length) return null
  return (
    <div className="mt-4 space-y-2 text-left">
      {senses.map(s => {
        const examples = parseList(s.examples)
        const zh = parseList(s.zh)
        let details: Array<{ ja?: string; en?: string; zh?: string; tatoeba_id?: number }> = []
        try { const value = JSON.parse(s.exampleDetails || '[]'); if (Array.isArray(value)) details = value } catch {}
        if (!examples.length && !details.length) return null
        return (
          <div key={s.id} title={s.gloss}>
            {details.length ? details.slice(0, 2).map((ex, index) => <div key={index} className="mb-2">
              <p lang="ja" className="text-sm text-zinc-500">{ex.ja}</p>
              {(ex.zh || ex.en) && <p className="mt-0.5 text-xs text-zinc-500">{ex.zh || `英文参考：${ex.en}`}</p>}
              {ex.tatoeba_id && <a className="text-xs text-indigo-500" href={`https://tatoeba.org/sentences/show/${ex.tatoeba_id}`} target="_blank" rel="noreferrer">例句来源</a>}
            </div>) : <p className="text-sm text-zinc-500">{examples[0]}</p>}
            {zh.length > 0 && <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">译词：{zh.join('、')}</p>}
          </div>
        )
      })}
    </div>
  )
}
