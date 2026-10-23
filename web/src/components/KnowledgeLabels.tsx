import type { KnowledgeInfo } from '../types'

export default function KnowledgeLabels({ knowledge, details = false }: { knowledge?: KnowledgeInfo | null; details?: boolean }) {
  if (!knowledge) return null
  return <div className="space-y-2 text-left text-xs text-zinc-500" data-testid="knowledge-labels">
    <div className="flex flex-wrap gap-1.5">{knowledge.tags.map(tag => <span key={`${tag.scheme}:${tag.key}`}
      className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">{tag.label}</span>)}</div>
    {details && knowledge.prerequisites.length > 0 && <p>先修：{knowledge.prerequisites.map(item => item.title).join('、')}</p>}
    {details && knowledge.sources.length > 0 && <p className="flex flex-wrap gap-x-3 gap-y-1">参考：{knowledge.sources.map(source => <a key={source.url}
      href={source.url} target="_blank" rel="noreferrer" className="underline">{source.title}</a>)}</p>}
  </div>
}
