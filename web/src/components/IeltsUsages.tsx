import Pronunciations from './Pronunciations'
import type { IeltsUsage } from '../types'

export default function IeltsUsages({ usages }: { usages?: IeltsUsage[] }) {
  if (!usages?.length) return null
  return (
    <div className="mt-4 space-y-2 text-left">
      <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">雅思词汇真经 · 不同章节用法</p>
      {usages.map(u => (
        <div key={u.id} className="rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
          <p className="text-xs text-zinc-500">{u.chapter}</p>
          <p className="text-sm">
            <span className="font-medium">{u.displayWord}</span>{' '}
            {u.phonetic && <span className="text-zinc-500"><Pronunciations fallback={u.phonetic} legacyLabel={u.phoneticProfile === 'learner-ipa-uk-v1' ? '英' : ''} /> </span>}
            {u.pos} {u.meaning}
          </p>
        </div>
      ))}
      <a href={usages[0].sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 underline">
        网络转录来源（未核对原书印次）
      </a>
    </div>
  )
}
