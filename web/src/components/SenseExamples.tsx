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
  if (!senses || !senses.length) return null
  return (
    <div className="mt-4 space-y-2 text-left">
      {senses.map(s => {
        const examples = parseList(s.examples)
        const zh = parseList(s.zh)
        if (!examples.length) return null
        return (
          <div key={s.senseIdx} title={s.gloss}>
            <p className="text-sm text-zinc-500 dark:text-zinc-500">{examples[0]}</p>
            {zh.length > 0 && (
              <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                译词：{zh.join('、')}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
