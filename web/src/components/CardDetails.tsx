import { useContentPreview } from '../hooks/useContentPreview'
import type { Card } from '../types'
import CardContent from './CardContent'
import CardAudio from './CardAudio'
import IeltsUsages from './IeltsUsages'
import SenseExamples from './SenseExamples'
import KnowledgeLabels from './KnowledgeLabels'

export default function CardDetails({ card }: { card: Card }) {
  const content = useContentPreview(card.front, card.back, card.contentFormat)
  return <div className="space-y-3">
    <KnowledgeLabels knowledge={card.knowledge} details />
    <div className="grid gap-4 md:grid-cols-2">
      {(['front', 'back'] as const).map(side => <div key={side} className="min-w-0">
        <p className="mb-2 text-xs text-zinc-500">{side === 'front' ? '正面' : '背面'}{content.pending ? ' · 加载中…' : ''}</p>
        <CardContent text={card[side]} rendered={content.preview?.[side]} className="text-sm" />
        <CardAudio items={(card.media || []).filter(item => item.side === side)} playbackKey={`details:${card.id}:${side}`} />
      </div>)}
    </div>
    {content.error && <p role="alert" className="text-xs text-red-600">内容加载失败：{content.error} <button onClick={content.retry} className="underline">重试</button></p>}
    <IeltsUsages usages={card.word?.ieltsUsages} />
    <SenseExamples senses={card.word?.senses} />
  </div>
}
